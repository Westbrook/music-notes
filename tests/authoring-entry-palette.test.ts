// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import type { MusicToggleButtonGroup } from '../src/ui/toggle-button-group.js';
import { pitchText } from '../src/model/pitch.js';
import { findAuthorControl, mountAuthorFixture, releaseAuthorFixture } from './author-fixture.js';

// Exercise the real workspace/command bridge, including direct toggle buttons.
// Native picker interaction and responsive measurement have component/browser tests.
const source = '<music-staff id="staff"><music-measure id="bar" incomplete></music-measure></music-staff>';
let workspace: AuthorWorkspace | undefined;

function control<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = findAuthorControl(document, id);
  if (!element) throw new Error(`Missing #${id}.`);
  return element as T;
}
const group = (id: string) => control<MusicToggleButtonGroup>(id);
async function flush(): Promise<void> {
  await Promise.resolve(); await Promise.resolve();
  await Promise.all(['entry-accidentals', 'entry-duration', 'entry-dots', 'entry-attack'].map(id => group(id).updateComplete));
}
async function field(id: string, value: string): Promise<void> {
  const element = control<HTMLInputElement | HTMLSelectElement>(id);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}
async function choose(id: string, value: string): Promise<void> {
  const element = group(id);
  expect(element.disabled).toBe(false);
  expect(element.options.some(option => option.value === value && !option.disabled)).toBe(true);
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  await flush();
}
async function clickChoice(id: string, value: string): Promise<void> {
  const button = [...group(id).shadowRoot!.querySelectorAll<HTMLButtonElement>('.controls > button')]
    .find(element => element.value === value);
  if (!button) throw new Error(`Missing direct choice ${value} in #${id}.`);
  expect(button.disabled).toBe(false);
  button.click();
  await flush();
}
function mount(): AuthorWorkspace {
  const values = new Map<string, string>();
  const recovery = new RecoveryStore({ key: 'entry-palette-test', writerId: 'entry-palette',
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  workspace = new AuthorWorkspace({ project: createProject(source, 'Quick writing choices'), recovery });
  control('toggle-entry').click();
  return workspace;
}

beforeEach(() => {
  mountAuthorFixture();
  vi.spyOn(control('author-workbench'), 'clientWidth', 'get').mockReturnValue(1180);
  vi.spyOn(AuthorWorkspace.prototype as unknown as { requestRender(): void }, 'requestRender').mockImplementation(() => {});
});
afterEach(async () => {
  workspace?.dispose(); workspace = undefined;
  vi.clearAllMocks(); vi.restoreAllMocks(); await releaseAuthorFixture();
});

describe('quick next-event palette', () => {
  it('exposes each complete vocabulary in Write tools with the requested leading options and overflow boundaries', async () => {
    mount(); await flush();
    const expected = [
      ['entry-accidentals', ['-1', '0', '1', '-2', '-1.5', '-0.5', '0.5', '1.5', '2'], 3, '0', undefined],
      ['entry-duration', ['half', 'quarter', 'eighth', 'sixteenth', 'whole', 'breve', 'thirty-second', 'sixty-fourth', '128th'], 4, 'quarter', undefined],
      ['entry-dots', ['1', '2', '3', '0'], 1, '0', '0'],
      ['entry-attack', ['articulation:accent', 'articulation:staccato', 'articulation:tenuto', 'articulation:marcato', 'articulation:staccatissimo', 'articulation:fermata',
        'ornament:trill', 'ornament:turn', 'ornament:inverted-turn', 'ornament:upper-mordent', 'ornament:lower-mordent', 'none'], 2, 'none', 'none'],
    ] as const;
    for (const [id, values, overflowAt, value, toggleOffValue] of expected) {
      const element = group(id);
      expect(control('write-tools').contains(element)).toBe(true);
      expect(element.options.map(option => option.value)).toEqual(values);
      expect(element.overflowAt).toBe(overflowAt);
      expect(element.value).toBe(value);
      expect(element.toggleOffValue).toBe(toggleOffValue);
      expect(element.getAttribute('toggle-off-value')).toBe(toggleOffValue ?? null);
      expect(element.options.every(option => option.icon)).toBe(true);
    }
    const duration = group('entry-duration');
    expect([...duration.shadowRoot!.querySelectorAll<HTMLButtonElement>('.controls > button')].map(button => button.value))
      .toEqual(['half', 'quarter', 'eighth', 'sixteenth']);
    expect(duration.shadowRoot!.querySelector('select option[value="whole"]')).not.toBeNull();
  });

  it('toggles dots and attack off before insertion while retaining required accidental and duration choices', async () => {
    const app = mount(); await flush();
    const before = { source: app.session.project.sourceHtml, revision: app.session.revision };
    await clickChoice('entry-dots', '1');
    await clickChoice('entry-attack', 'articulation:accent');
    expect(group('entry-dots').value).toBe('1');
    expect(control<HTMLSelectElement>('event-dots').value).toBe('1');
    expect(group('entry-attack').value).toBe('articulation:accent');
    for (const id of ['entry-dots', 'entry-attack']) {
      expect(group(id).shadowRoot!.querySelectorAll('.controls > button[aria-pressed="true"]')).toHaveLength(1);
    }

    await clickChoice('entry-dots', '1');
    await clickChoice('entry-attack', 'articulation:accent');
    expect(group('entry-dots').value).toBe('0');
    expect(control<HTMLSelectElement>('event-dots').value).toBe('0');
    expect(group('entry-attack').value).toBe('none');
    for (const id of ['entry-dots', 'entry-attack']) {
      expect(group(id).shadowRoot!.querySelector('.controls > button[aria-pressed="true"]')).toBeNull();
      expect(group(id).shadowRoot!.querySelector('select')!.dataset.selected).toBe('false');
    }
    await clickChoice('entry-accidentals', '0');
    await clickChoice('entry-duration', 'quarter');
    expect(group('entry-accidentals').value).toBe('0');
    expect(group('entry-duration').value).toBe('quarter');
    expect({ source: app.session.project.sourceHtml, revision: app.session.revision }).toEqual(before);
    expect(app.session.canUndo).toBe(false);

    control('insert-event').click(); await flush();
    const event = app.session.score.staves[0].measures[0].voices[0].events[0];
    expect(pitchText(event.pitches[0])).toBe('C4');
    expect(event).toMatchObject({ duration: 'quarter', dots: 0 });
    expect(event.markings ?? []).toEqual([]);
    expect(app.session.revision).toBe(before.revision + 1);
  });

  it('keeps direct and popup choices synchronized without editing accepted music', async () => {
    const app = mount(); await field('event-pitch', 'F4');
    const before = { source: app.session.project.sourceHtml, revision: app.session.revision };
    await choose('entry-accidentals', '1.5');
    await choose('entry-duration', 'whole');
    await choose('entry-dots', '2');
    expect(control<HTMLInputElement>('event-pitch').value).toBe('Ftqs4');
    expect(control<HTMLSelectElement>('event-alteration').value).toBe('1.5');
    expect(control<HTMLSelectElement>('event-duration').value).toBe('whole');
    expect(group('entry-duration').shadowRoot!.querySelector<HTMLSelectElement>('select')!.dataset.selected).toBe('true');
    expect(group('entry-duration').shadowRoot!.querySelector('.controls > button[value="whole"]')).toBeNull();
    expect(control<HTMLSelectElement>('event-dots').value).toBe('2');
    await field('event-pitch', 'Ab5');
    await field('event-duration', '128th');
    await field('event-dots', '3');
    expect(group('entry-accidentals').value).toBe('-1');
    expect(group('entry-duration').value).toBe('128th');
    expect(group('entry-dots').value).toBe('3');
    await choose('entry-dots', '0');
    expect(control<HTMLSelectElement>('event-dots').value).toBe('0');
    expect({ source: app.session.project.sourceHtml, revision: app.session.revision }).toEqual(before);
    expect(app.session.canUndo).toBe(false);
  });

  it('writes the selected recipe and attack in one undo step and keeps the recipe through Select', async () => {
    const app = mount(); await flush();
    await choose('entry-accidentals', '-0.5');
    await choose('entry-duration', 'eighth');
    await choose('entry-dots', '1');
    await choose('entry-attack', 'ornament:turn');
    const before = app.session.project.sourceHtml;
    const revision = app.session.revision;
    control('insert-event').click(); await flush();
    const event = app.session.score.staves[0].measures[0].voices[0].events[0];
    expect(pitchText(event.pitches[0])).toBe('Cqf4');
    expect(event).toMatchObject({ duration: 'eighth', dots: 1, markings: [{ kind: 'ornament', type: 'turn' }] });
    expect(app.session.revision).toBe(revision + 1);
    expect(event.markings?.[0].id).toBeTruthy();
    control('select-mode').click(); await flush();
    app.session.select(event.id); await flush();
    expect(group('entry-attack').value).toBe('ornament:turn');
    expect(group('entry-duration').value).toBe('eighth');
    app.session.undo(); await flush();
    expect(app.session.project.sourceHtml).toBe(before);
    expect(app.session.canUndo).toBe(false);
    expect(group('entry-attack').value).toBe('ornament:turn');
  });

  it('retains invalid pitch text, disables inapplicable values, and resets incompatible attacks when choosing rests', async () => {
    mount(); await field('event-pitch', 'F#4');
    await field('event-pitch', 'unfinished');
    expect(group('entry-accidentals').disabled).toBe(true);
    expect(group('entry-accidentals').value).toBe('1');
    expect(control<HTMLInputElement>('event-pitch').value).toBe('unfinished');
    await choose('entry-attack', 'articulation:accent');
    control('entry-choose-rest').click(); await flush();
    expect(group('entry-attack').value).toBe('none');
    expect(group('entry-attack').options.filter(option => !option.disabled).map(option => option.value)).toEqual(['articulation:fermata', 'none']);
    expect(control('entry-attack-status').textContent).toMatch(/Accent.*None/);
    expect(group('entry-accidentals').disabled).toBe(true);
    await choose('entry-attack', 'articulation:fermata');
    const measureRest = control<HTMLInputElement>('event-measure-rest');
    measureRest.checked = true; measureRest.dispatchEvent(new Event('input', { bubbles: true })); await flush();
    expect(group('entry-duration').disabled).toBe(true);
    expect(group('entry-dots').disabled).toBe(true);
    expect(group('entry-attack').value).toBe('articulation:fermata');
  });
});
