// @vitest-environment happy-dom
import { findAuthorControl, mountAuthorFixture } from './author-fixture.js';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { MUSIC_ATTRIBUTES } from '../src/dom/attributes.js';
import { ARTICULATION_TYPES, ORNAMENT_TYPES, parseDuration, validateAlteration, validateClef } from '../src/model/index.js';
import { EditorSession } from '../src/authoring/editor.js';
import { EventMarkingsEditor } from '../src/authoring/event-markings-editor.js';
import { createProject, importProject, serializeProject } from '../src/authoring/project.js';
import {
  ACCIDENTAL_DISPLAY_CAPABILITIES, ANNOTATION_CAPABILITIES, ANNOTATION_PLACEMENT_CAPABILITIES,
  ARTICULATION_CAPABILITIES, AUTHORING_ROUTES, BARLINE_CAPABILITIES, BEAM_CAPABILITIES, BREAK_CAPABILITIES,
  CLEF_CAPABILITIES, DEFAULT_ENTRY_KIND, DURATION_CAPABILITIES, ENTRY_KINDS,
  EVENT_CAPABILITIES, MARKING_CAPABILITIES, NOTATION_ELEMENT_CAPABILITIES,
  MARK_PLACEMENT_CAPABILITIES, ORNAMENT_CAPABILITIES, PITCH_ALTERATION_CAPABILITIES, PITCH_ALTERATIONS,
  PITCH_DIRECTION_CAPABILITIES, SCORE_BRACKET_CAPABILITIES, STAFF_CAPABILITIES, STEM_CAPABILITIES,
  TIE_CAPABILITIES, TUPLET_BRACKET_CAPABILITIES,
} from '../src/authoring/notation-capabilities.js';
import type { AuthoringRoute, ElementCapability } from '../src/authoring/notation-capabilities.js';

const cleanups: (() => void)[] = [];

function shell(): void {
  mountAuthorFixture();
}

function select(id: string): HTMLSelectElement {
  const element = findAuthorControl(document, id);
  if (!(element instanceof HTMLSelectElement)) throw new Error(`Missing actual native Author choice: ${id}`);
  return element;
}

function values(element: HTMLSelectElement): string[] { return [...element.options].map(option => option.value); }
function sorted(items: readonly string[]): string[] { return [...items].sort(); }

function expectNative(element: HTMLSelectElement): void {
  expect(element.firstElementChild?.tagName).toBe('BUTTON');
  expect(element.firstElementChild?.querySelector('selectedcontent')).not.toBeNull();
  for (const option of element.options) expect(option.hasAttribute('value')).toBe(true);
}

afterEach(() => {
  cleanups.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
});

describe('COVERAGE-VOCABULARY model choices and actual Author controls', () => {
  it('gives each mapped feature a named route and an explicit limit, without requiring every attribute to be visual', () => {
    shell();
    const records = [STAFF_CAPABILITIES, EVENT_CAPABILITIES, MARKING_CAPABILITIES,
      ARTICULATION_CAPABILITIES, ORNAMENT_CAPABILITIES, PITCH_DIRECTION_CAPABILITIES, PITCH_ALTERATION_CAPABILITIES,
      DURATION_CAPABILITIES, CLEF_CAPABILITIES, STEM_CAPABILITIES, BEAM_CAPABILITIES, ACCIDENTAL_DISPLAY_CAPABILITIES,
      ANNOTATION_CAPABILITIES, ANNOTATION_PLACEMENT_CAPABILITIES, MARK_PLACEMENT_CAPABILITIES,
      BARLINE_CAPABILITIES, TUPLET_BRACKET_CAPABILITIES, BREAK_CAPABILITIES, TIE_CAPABILITIES, SCORE_BRACKET_CAPABILITIES];
    for (const record of records) for (const capability of Object.values(record)) {
      expect(capability.label.trim()).not.toBe('');
      expect(capability.routes.length).toBeGreaterThan(0);
      expect(capability.limitation.trim()).not.toBe('');
      for (const route of capability.routes) expect(AUTHORING_ROUTES).toHaveProperty(route);
    }
    for (const route of Object.values(AUTHORING_ROUTES)) {
      expect(route.path.trim()).not.toBe('');
      expect(route.controls.length).toBeGreaterThan(0);
      for (const id of route.controls) expect(findAuthorControl(document, id), `${route.path}: #${id}`).not.toBeNull();
    }
  });

  it('covers staff choices, compatible entry kinds, defaults and both event-kind selectors', () => {
    shell();
    expectNative(select('staff-notation'));
    expect(sorted(values(select('staff-notation')))).toEqual(sorted(Object.keys(STAFF_CAPABILITIES)));
    for (const option of select('staff-notation').options) expect(option.textContent?.trim()).toBe(STAFF_CAPABILITIES[option.value as keyof typeof STAFF_CAPABILITIES].label);
    expect(sorted(Object.keys(ENTRY_KINDS))).toEqual(sorted(Object.keys(STAFF_CAPABILITIES)));
    expect(sorted(Object.keys(DEFAULT_ENTRY_KIND))).toEqual(sorted(Object.keys(STAFF_CAPABILITIES)));
    const entries = [...new Set(Object.values(EVENT_CAPABILITIES).flatMap(capability => capability.entryChoices))];
    for (const id of ['event-kind', 'selected-kind']) {
      expectNative(select(id));
      expect(sorted(values(select(id)))).toEqual(sorted(entries));
    }
    for (const [notation, kinds] of Object.entries(ENTRY_KINDS)) {
      const staff = notation as keyof typeof STAFF_CAPABILITIES;
      expect(kinds).toContain(DEFAULT_ENTRY_KIND[staff]);
      const applicable = Object.values(EVENT_CAPABILITIES).filter(capability => (capability.staves as readonly string[]).includes(staff))
        .flatMap(capability => capability.entryChoices);
      expect(sorted(kinds)).toEqual(sorted(applicable));
    }
  });

  it('keeps all native road-direction choices aligned with the model-facing vocabulary', () => {
    shell();
    for (const id of ['event-direction', 'selected-direction', 'convert-direction', 'note-direction']) {
      const element = select(id);
      expectNative(element);
      expect(values(element)).toEqual(Object.keys(PITCH_DIRECTION_CAPABILITIES));
      for (const option of element.options) expect(option.textContent?.trim()).toBe(PITCH_DIRECTION_CAPABILITIES[option.value as keyof typeof PITCH_DIRECTION_CAPABILITIES].label);
    }
  });

  it('keeps a dedicated road-direction chooser beside the staff without visiting general entry settings', () => {
    shell();
    expect(AUTHORING_ROUTES.direction.path).toMatch(/beside the staff/i);
    const trigger = document.getElementById('entry-direction-trigger') as HTMLButtonElement;
    const chooser = document.getElementById('entry-direction-chooser')!;
    expect(trigger?.type).toBe('button');
    expect(trigger.closest('#write-tools')).not.toBeNull();
    expect(trigger.closest('#entry-slot-options')).not.toBeNull();
    expect(trigger.getAttribute('popovertarget')).toBe(chooser.id);
    expect(chooser.getAttribute('popover')).toBe('auto');
    expect(chooser.closest('#workspace-dock, #entry-settings')).toBeNull();
    for (const [direction, capability] of Object.entries(PITCH_DIRECTION_CAPABILITIES)) {
      const button = document.getElementById(`entry-direction-${direction}`) as HTMLButtonElement;
      expect(button?.type).toBe('button');
      expect(button.closest('#entry-direction-chooser')).toBe(chooser);
      expect(button.textContent?.trim()).toBe(capability.label);
      expect(['true', 'false']).toContain(button.getAttribute('aria-pressed'));
      expect(AUTHORING_ROUTES.direction.controls).toContain(button.id);
    }
    const options = document.getElementById('entry-direction-options') as HTMLButtonElement;
    expect(options?.type).toBe('button');
    expect(options.closest('#entry-direction-chooser')).toBe(chooser);
    expect(options.getAttribute('popovertarget')).toBe('entry-settings');
    // The complete options form retains its canonical native field; the small
    // chooser adds a frequent-task route rather than another musical authority.
    expect(select('event-direction').closest('#entry-settings')).not.toBeNull();
    expect(select('selection-direction').closest('#selection-pitch-chooser')).not.toBeNull();
    expect(select('note-direction').closest('#note-editor')).not.toBeNull();
    expect(select('selected-direction').closest('#selection-inspector')).not.toBeNull();
  });

  it('documents exact-recipe Enter alongside Insert without retaining an Insert-only limitation', () => {
    shell();
    expect(AUTHORING_ROUTES.entry.path).toMatch(/Insert or Enter/);
    expect(AUTHORING_ROUTES.entry.controls).toContain('score-editor');
    expect(AUTHORING_ROUTES.entry.controls).toContain('insert-event');
    expect(document.getElementById('score-editor')?.getAttribute('tabindex')).toBe('0');
    for (const capability of [...Object.values(STAFF_CAPABILITIES), ...Object.values(EVENT_CAPABILITIES)]) {
      if (capability.limitation.includes('Insert')) expect(capability.limitation).toContain('Enter');
    }
  });

  it('documents the direct chord-pitch action and its existing Edit destination', () => {
    shell();
    expect(AUTHORING_ROUTES.chord.path).toMatch(/Edit chord pitches/);
    expect(AUTHORING_ROUTES.chord.controls).toContain('note-advanced-edit');
    expect(AUTHORING_ROUTES.chord.controls).toContain('selected-pitches');
    expect(document.getElementById('note-advanced-edit')?.closest('#note-editor')).not.toBeNull();
    expect(document.getElementById('selected-pitches')?.closest('#selection-inspector')).not.toBeNull();
  });

  it('keeps exact attached-mark routes separate from fixed-position annotations', () => {
    shell();
    expect(AUTHORING_ROUTES.attached.path).toMatch(/exact.*row/i);
    expect(AUTHORING_ROUTES.attached.controls).toEqual(expect.arrayContaining(['edit-selected-event', 'note-attached-marks', 'event-markings-rows']));
    for (const capability of Object.values(MARKING_CAPABILITIES)) expect(capability.routes).toContain('attached');
    expect(document.getElementById('note-attached-marks')?.closest('#note-editor')).not.toBeNull();
    expect(document.getElementById('event-markings-rows')?.closest('#selection-inspector')).not.toBeNull();
    expect(AUTHORING_ROUTES.attached.controls).not.toContain('annotation-text');
    expect(document.getElementById('annotation-text')?.closest('#annotation-inspector')).not.toBeNull();
  });

  it('covers the explicit complete-tie interval scope without claiming segment marks move with it', () => {
    shell();
    const scope = document.getElementById('event-markings-tie-scope') as HTMLInputElement;
    expect(scope?.tagName).toBe('INPUT');
    expect(scope.type).toBe('checkbox');
    expect(scope.checked).toBe(false);
    expect(scope.closest('#event-markings-editor')).not.toBeNull();
    expect(scope.labels?.[0].textContent).toMatch(/interval edits.*complete tie chain/i);
    expect(AUTHORING_ROUTES.intervalChain.controls).toContain(scope.id);
    expect(MARKING_CAPABILITIES.interval.routes).toContain('intervalChain');
    expect(EVENT_CAPABILITIES.road.routes).toContain('intervalChain');
    expect(MARKING_CAPABILITIES.interval.limitation).toMatch(/articulations.*ornaments/);
    expect(MARKING_CAPABILITIES.articulation.routes).not.toContain('intervalChain');
    expect(MARKING_CAPABILITIES.ornament.routes).not.toContain('intervalChain');
  });

  it('exposes sorted typed alterations and labels accepted by the existing model validator', () => {
    const expected = Object.keys(PITCH_ALTERATION_CAPABILITIES).map(Number).sort((a, b) => a - b);
    expect(PITCH_ALTERATIONS.map(choice => choice.value)).toEqual(expected);
    expect(new Set(PITCH_ALTERATIONS.map(choice => choice.value)).size).toBe(PITCH_ALTERATIONS.length);
    for (const choice of PITCH_ALTERATIONS) {
      expect(validateAlteration(choice.value)).toBe(choice.value);
      expect(choice.label).toBe(PITCH_ALTERATION_CAPABILITIES[choice.value].label);
      expect(choice.label.trim()).not.toBe('');
    }
    expect(Object.isFrozen(PITCH_ALTERATIONS)).toBe(true);
    expect(PITCH_ALTERATIONS.every(Object.isFrozen)).toBe(true);
  });

  it('covers existing quick accidental buttons and the quarter-tone native choice', () => {
    shell();
    const fractional = PITCH_ALTERATIONS.filter(choice => !Number.isInteger(choice.value)).map(choice => String(choice.value));
    expectNative(select('note-microtone'));
    expect(values(select('note-microtone')).filter(Boolean)).toEqual(fractional);
    const ordinary: Record<string, number> = { 'note-double-flat': -2, 'note-flat': -1, 'note-natural': 0, 'note-sharp': 1, 'note-double-sharp': 2 };
    expect(sorted(Object.values(ordinary).map(String))).toEqual(sorted(PITCH_ALTERATIONS.filter(choice => Number.isInteger(choice.value)).map(choice => String(choice.value))));
    for (const id of Object.keys(ordinary)) expect(findAuthorControl(document, id)?.tagName).toBe('BUTTON');
  });

  it('keeps the actual Next entry alteration picker aligned with every supported labelled value', () => {
    shell();
    const element = select('event-alteration');
    expectNative(element);
    expect(values(element)).toEqual(PITCH_ALTERATIONS.map(choice => String(choice.value)));
    for (const [index, option] of [...element.options].entries()) {
      expect(option.textContent?.trim().startsWith(PITCH_ALTERATIONS[index].label)).toBe(true);
    }
    expect(document.getElementById('event-alteration-status')?.getAttribute('role')).toBe('status');
  });

  it('keeps marking type coverage equal to the primary model vocabulary', () => {
    expect(sorted(Object.keys(ARTICULATION_CAPABILITIES))).toEqual(sorted(ARTICULATION_TYPES));
    expect(sorted(Object.keys(ORNAMENT_CAPABILITIES))).toEqual(sorted(ORNAMENT_TYPES));
  });

  it('compares the actual dynamically generated marking selects, not a second static dropdown fixture', () => {
    shell();
    const session = new EditorSession(createProject('<music-staff id="staff" notation="three-roads"><music-measure id="bar"><music-road id="main-note" direction="same" duration="whole"></music-road></music-measure></music-staff>'));
    session.select('main-note');
    const editor = new EventMarkingsEditor({ session, context: () => ({ mode: 'write', selectionId: 'main-note', rangeEventIds: ['main-note'] }), select: id => session.select(id) });
    cleanups.push(() => editor.dispose());
    const before = { source: session.project.sourceHtml, revision: session.revision };
    for (const kind of Object.keys(MARKING_CAPABILITIES)) (document.getElementById(`add-event-${kind}`) as HTMLButtonElement).click();
    for (const [kind, types] of [['articulation', ARTICULATION_CAPABILITIES], ['ornament', ORNAMENT_CAPABILITIES]] as const) {
      const element = document.querySelector<HTMLSelectElement>(`[data-marking-kind="${kind}"] [data-marking-field="type"]`);
      expect(element).not.toBeNull();
      expectNative(element!);
      expect(sorted(values(element!))).toEqual(sorted(Object.keys(types)));
      for (const option of element!.options) expect(option.textContent).toBe((types as Record<string, { label: string }>)[option.value].label);
    }
    for (const element of document.querySelectorAll<HTMLSelectElement>('#event-markings-rows select')) expectNative(element);
    for (const kind of ['articulation', 'ornament']) {
      expect(document.querySelector(`[data-marking-kind="${kind}"] [data-marking-field="placement"]`)).toBeNull();
    }
    const intervalPlacement = document.querySelector<HTMLSelectElement>('[data-marking-kind="interval"] [data-marking-field="placement"]')!;
    expectNative(intervalPlacement);
    const liveDirections = Object.entries(MARK_PLACEMENT_CAPABILITIES).filter(([, capability]) => capability.routes.some(route => route === 'interval')).map(([value]) => value);
    expect(values(intervalPlacement)).toEqual(liveDirections);
    expect(document.getElementById('event-markings-placement-help')?.textContent).toMatch(/automatically/i);
    expect(document.querySelector('[data-marking-kind="interval"] [data-marking-field="value"]')?.tagName).toBe('INPUT');
    expect({ source: session.project.sourceHtml, revision: session.revision }).toEqual(before);
  });
});

describe('COVERAGE-VOCABULARY other current notation choices', () => {
  it.each([
    ['written duration', ['event-duration', 'selected-duration', 'note-duration', 'annotation-beat'], DURATION_CAPABILITIES],
    ['clef', ['staff-clef', 'measure-clef'], CLEF_CAPABILITIES],
    ['stem direction', ['event-stem', 'selected-stem'], STEM_CAPABILITIES],
    ['beam policy', ['event-beam', 'selected-beam'], BEAM_CAPABILITIES],
    ['accidental display', ['event-accidental-display', 'selected-accidental-display'], ACCIDENTAL_DISPLAY_CAPABILITIES],
    ['annotation kind', ['annotation-kind'], ANNOTATION_CAPABILITIES],
    ['annotation placement', ['annotation-placement'], ANNOTATION_PLACEMENT_CAPABILITIES],
    ['barline', ['measure-end-bar'], BARLINE_CAPABILITIES],
    ['tuplet bracket', ['tuplet-bracket'], TUPLET_BRACKET_CAPABILITIES],
    ['layout break', ['layout-break'], BREAK_CAPABILITIES],
  ] as const)('keeps every native %s choice aligned with its exhaustive primary-model record', (_name, ids, vocabulary) => {
    shell();
    const choices: Readonly<Record<string, { label: string }>> = vocabulary;
    for (const id of ids) {
      const element = select(id);
      expectNative(element);
      expect(sorted(values(element))).toEqual(sorted(Object.keys(choices)));
      for (const option of element.options) expect(option.textContent?.trim()).toBe(choices[option.value].label);
    }
  });

  it('uses existing model parsers for named durations and clefs instead of implementing another grammar', () => {
    for (const duration of Object.keys(DURATION_CAPABILITIES)) expect(parseDuration(duration)).toBe(duration);
    for (const clef of Object.keys(CLEF_CAPABILITIES)) expect(validateClef(clef)).toBe(clef);
  });

  it('documents tie policies as musical operations and raw score brackets as a Source boundary', () => {
    shell();
    for (const capability of Object.values(TIE_CAPABILITIES)) {
      expect(capability.routes).toContain('ties');
      expect(capability.limitation).toMatch(/chain/i);
    }
    for (const capability of Object.values(SCORE_BRACKET_CAPABILITIES)) {
      expect(capability.routes).toEqual(['source']);
      expect(capability.limitation).toMatch(/Source/);
    }
    for (const id of ['tie-events', 'clear-ties']) expect(findAuthorControl(document, id)?.tagName).toBe('BUTTON');
    expect(NOTATION_ELEMENT_CAPABILITIES['music-system'].attributes.bracket.route).toBe('source');
  });

  it('documents standard-mark placement as automatic with legacy Source data, not a hidden manual engraving control', () => {
    for (const kind of ['articulation', 'ornament'] as const) {
      const placement = NOTATION_ELEMENT_CAPABILITIES[`music-${kind}`].attributes.placement;
      expect(placement.route).toBe('source');
      expect(placement.note).toMatch(/legacy/i);
      expect(placement.note).toMatch(/automatic/i);
      expect(MARKING_CAPABILITIES[kind].limitation).toMatch(/automatic/i);
    }
    expect(MARK_PLACEMENT_CAPABILITIES.auto.routes).toEqual(['source']);
    expect(MARK_PLACEMENT_CAPABILITIES.auto.limitation).toMatch(/articulations only/i);
    for (const direction of ['above', 'below'] as const) {
      expect(MARK_PLACEMENT_CAPABILITIES[direction].routes).toContain('interval');
      expect(MARK_PLACEMENT_CAPABILITIES[direction].limitation).toMatch(/legacy/i);
      expect(MARK_PLACEMENT_CAPABILITIES[direction].limitation).toMatch(/do not control/i);
    }
  });

  it('round-trips legacy standard-mark placement and does not rewrite it during an ordinary type edit', () => {
    shell();
    const source = '<music-staff id="staff"><music-measure id="bar"><music-note id="note" pitch="C4" duration="whole"><music-articulation id="accent" type="accent" placement="above" data-author="keep accent"></music-articulation><music-ornament id="turn" type="turn" placement="below" data-author="keep turn"></music-ornament></music-note></music-measure></music-staff>';
    const project = createProject(source);
    const restored = importProject(serializeProject(project));
    expect(restored.sourceHtml).toBe(project.sourceHtml);
    const session = new EditorSession(restored);
    session.select('note');
    const before = { source: session.project.sourceHtml, revision: session.revision };
    const editor = new EventMarkingsEditor({ session, context: () => ({ mode: 'write', selectionId: 'note', rangeEventIds: ['note'] }), select: id => session.select(id) });
    cleanups.push(() => editor.dispose());
    expect({ source: session.project.sourceHtml, revision: session.revision }).toEqual(before);
    for (const [id, type] of [['accent', 'tenuto'], ['turn', 'trill']]) {
      const row = document.querySelector(`[data-marking-id="${id}"]`)!;
      expect(row.querySelector('[data-marking-field="placement"]')).toBeNull();
      const field = row.querySelector<HTMLSelectElement>('[data-marking-field="type"]')!;
      field.value = type;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    (document.getElementById('apply-event-markings') as HTMLButtonElement).click();
    expect(session.revision).toBe(before.revision + 1);
    expect(session.source.querySelector('#accent')?.getAttribute('type')).toBe('tenuto');
    expect(session.source.querySelector('#turn')?.getAttribute('type')).toBe('trill');
    expect(session.source.querySelector('#accent')?.getAttribute('placement')).toBe('above');
    expect(session.source.querySelector('#turn')?.getAttribute('placement')).toBe('below');
    expect(session.source.querySelector('#accent')?.getAttribute('data-author')).toBe('keep accent');
    expect(session.source.querySelector('#turn')?.getAttribute('data-author')).toBe('keep turn');
    session.undo();
    expect(session.project.sourceHtml).toBe(before.source);
  });
});

/** Inventory declared registrations without importing renderers or mounting MusicSurface. */
function registeredElements(): string[] {
  const directory = resolve('src/components');
  const tags: string[] = [];
  for (const name of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
    const source = ts.createSourceFile(name, readFileSync(resolve(directory, name), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'registerElement') {
        expect(ts.isStringLiteral(node.arguments[0]), `Use an inventoried literal registration in ${name}`).toBe(true);
        tags.push((node.arguments[0] as ts.StringLiteral).text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(new Set(tags).size).toBe(tags.length);
  return tags.sort();
}

describe('COVERAGE-VOCABULARY notation element and attribute boundaries', () => {
  it('requires a coverage decision for every declared notation registration and DOM schema element', () => {
    const covered = sorted(Object.keys(NOTATION_ELEMENT_CAPABILITIES));
    expect(registeredElements()).toEqual(covered);
    expect(sorted(Object.keys(MUSIC_ATTRIBUTES))).toEqual(covered);
  });

  it('requires an explicit route or Source boundary for every schema attribute', () => {
    shell();
    for (const [tag, value] of Object.entries(NOTATION_ELEMENT_CAPABILITIES)) {
      const capability: ElementCapability = value;
      expect(capability.description.trim()).not.toBe('');
      expect(AUTHORING_ROUTES).toHaveProperty(capability.route);
      expect(sorted(Object.keys(capability.attributes)), tag).toEqual(sorted(MUSIC_ATTRIBUTES[tag]));
      for (const [attribute, coverage] of Object.entries(capability.attributes)) {
        expect(AUTHORING_ROUTES).toHaveProperty(coverage.route);
        if (coverage.route === 'source') expect(coverage.note?.trim(), `${tag}[${attribute}] needs a Source boundary explanation`).toBeTruthy();
      }
    }
  });

  it('keeps raw surface layout, legacy aliases and schema-only identity choices explicit', () => {
    const attributes = (tag: keyof typeof NOTATION_ELEMENT_CAPABILITIES) => NOTATION_ELEMENT_CAPABILITIES[tag].attributes as ElementCapability['attributes'];
    expect(attributes('music-system').bracket.route).toBe('source');
    expect(attributes('music-note').triplet.route).toBe('source');
    expect(attributes('music-note').dotted.route).toBe('source');
    expect(attributes('music-measure').number.route).toBe('source');
    expect(attributes('music-system')['print-width'].route).toBe('source');
    expect(attributes('music-road').direction.route).not.toBe('source');
    expect(attributes('music-interval').value.route).not.toBe('source');
    const routes: Readonly<Record<string, AuthoringRoute>> = AUTHORING_ROUTES;
    expect(routes.source.controls).toContain('source-input');
  });
});
