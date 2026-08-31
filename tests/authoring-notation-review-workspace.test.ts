// @vitest-environment happy-dom
/**
 * Real Author shell, EditorSession, DOM reader and MusicSurface scheduling.
 * The engraving adapter supplies explicit diagnostics and an empty SVG only;
 * no notation geometry, native popovers, pixels, physical input or PDF is claimed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngravingOptions, EngravingResult } from '../src/engraving/render.js';
import type { Diagnostic, Score } from '../src/model/types.js';

const engine = vi.hoisted(() => ({
  ready: vi.fn<() => Promise<void>>(),
  render: vi.fn<(container: HTMLElement, score: Score, options: EngravingOptions) => EngravingResult>(),
}));
vi.mock('../src/engraving/render.js', () => ({ engravingReady: engine.ready, renderScore: engine.render }));
import '../src/engraving/render.js';
import authorHtml from '../author.html?raw';
import { AuthorWorkspace } from '../src/authoring/main.js';
import { MusicSurface } from '../src/components/music-surface.js';
import { createProject } from '../src/authoring/project.js';
import { RecoveryStore } from '../src/authoring/storage.js';
import type { RecoveryStorage } from '../src/authoring/storage.js';
import type { AuthorCommand, AuthorProject } from '../src/authoring/types.js';
import type { PointerFeedback } from '../src/authoring/staff-interaction.js';

const shell = authorHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
const empty = '<music-staff id="lead" label="Lead"><music-measure id="bar" number="12" meter="4/4" incomplete><music-voice id="voice"></music-voice></music-measure></music-staff>';
const partial = empty.replace('</music-voice>', '<music-note id="written" pitch="F4" duration="quarter"></music-note></music-voice>');
const complete = partial.replace('duration="quarter"', 'duration="whole"');
const warning: Diagnostic = { severity: 'warning', code: 'review-fixture', sourceId: 'voice', measureId: 'bar', message: 'Fixture engraving notice.' };
const releases = new Set<() => void>();
let app: AuthorWorkspace | undefined;
let sequence = 0;
let adapterNotices: (container: HTMLElement, score: Score) => readonly Diagnostic[] = () => [];

class ResizeObserverDouble implements ResizeObserver {
  observe(): void {} unobserve(): void {} disconnect(): void {}
}
function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing actual Author control #${id}.`);
  return element as T;
}
function surface(): MusicSurface {
  const element = el('score-host').shadowRoot!.querySelector('.score-mount > *');
  if (!(element instanceof MusicSurface)) throw new Error('The actual workspace has not mounted its MusicSurface.');
  return element;
}
function draw(container: HTMLElement, score: Score): EngravingResult {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('notation-svg'); svg.dataset.scoreId = score.id;
  container.replaceChildren(svg);
  // No geometry is invented. Tests below address lifecycle/ownership and the
  // diagnostic presentation contract, not the width or position of the staff.
  return { systems: [], hitRegions: [], diagnostics: [...adapterNotices(container, score)] };
}
async function nextTask(): Promise<void> {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
  else await new Promise<void>(resolve => setTimeout(resolve, 0));
}
async function settled(expected: 'ready' | 'error' = 'ready'): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    await nextTask();
    if (document.body.dataset.renderState === expected && document.body.dataset.authorReady === 'true') return;
    if (expected !== 'error' && document.body.dataset.renderState === 'error') throw new Error(el('author-errors').textContent ?? 'Author rendering failed.');
  }
  throw new Error(`Author did not settle as ${expected}: ${document.body.dataset.renderState}.`);
}
function available(element: HTMLElement): boolean {
  return !element.closest('[hidden],[inert],[aria-hidden="true"]') && !element.matches(':disabled');
}
async function click(id: string): Promise<void> {
  const element = el(id); expect(available(element), `#${id} is reachable`).toBe(true);
  element.focus({ preventScroll: true }); element.click(); await nextTask();
}
async function field(id: string, value: string): Promise<void> {
  const element = el<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
  expect(available(element), `#${id} is reachable`).toBe(true);
  if (element instanceof HTMLSelectElement) expect([...element.options].some(option => option.value === value && !option.disabled)).toBe(true);
  element.focus({ preventScroll: true }); element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); await nextTask();
}
async function key(key: string): Promise<void> {
  expect(document.activeElement).toBe(el('score-editor'));
  const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
  el('score-editor').dispatchEvent(event); expect(event.defaultPrevented).toBe(true); await settled();
}
function mount(source = empty, storage?: RecoveryStorage, project?: AuthorProject): void {
  const records = new Map<string, string>();
  const recovery = new RecoveryStore({ key: `notation-review-${++sequence}`, writerId: 'notation-review-test',
    storage: storage ?? { getItem: key => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value); }, removeItem: key => { records.delete(key); } },
    locks: { request: async (_name, action) => action() },
  });
  app = new AuthorWorkspace({ project: project ?? createProject(source, 'Notation Review'), recovery });
}
function accepted() {
  return { project: structuredClone(app!.session.project), revision: app!.session.revision,
    cursor: app!.session.cursor, selection: app!.session.selection,
    undo: app!.session.canUndo, redo: app!.session.canRedo };
}
function noticeRows(): HTMLLIElement[] { return [...el('notation-review-list').querySelectorAll('li')]; }
function codes(): (string | undefined)[] { return noticeRows().map(row => row.dataset.diagnosticCode); }
function requireNotices(expected: string[]): void {
  expect(codes()).toEqual(expected);
  expect(el('notation-review').hidden).toBe(!expected.length);
  expect(el('notation-review-heading').textContent).toBe(`${expected.length} notation notice${expected.length === 1 ? '' : 's'}`);
  const realWarnings = surface().diagnostics.filter(item => item.severity === 'warning');
  for (const row of noticeRows()) expect(realWarnings.some(item => item.code === row.dataset.diagnosticCode
    && item.sourceId === row.dataset.sourceId && row.textContent === `${item.message} [${item.sourceId}]`)).toBe(true);
}
function feedback() {
  const element = el('workspace-feedback-label');
  return { text: element.textContent, title: element.title, kind: element.dataset.feedbackKind,
    live: element.getAttribute('aria-live'), error: el('author-errors').textContent, errorHidden: el('author-errors').hidden };
}
function entryRecipe() {
  return { fields: ['event-kind', 'event-pitch', 'event-duration', 'event-dots', 'insert-position', 'event-direction']
    .map(id => [id, el<HTMLInputElement | HTMLSelectElement>(id).value]),
  measureRest: el<HTMLInputElement>('event-measure-rest').checked };
}
/**
 * Explicit controller presentation boundary: invoke the real announce callback
 * and public cancel/clear path without constructing fictitious note geometry.
 * These checks do not establish gesture admission, dragging or native input.
 */
function pointerFeedbackBoundary() {
  return (app as unknown as { staffInteraction: {
    announce(message: string, kind: PointerFeedback['kind']): void;
    cancel(reason?: string): void;
    options: { commit(command: AuthorCommand): void };
  } }).staffInteraction;
}
function holdEngraving(): () => void {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  engine.ready.mockImplementation(() => pending); releases.add(release);
  return () => { releases.delete(release); release(); engine.ready.mockResolvedValue(); };
}
async function startWriting(): Promise<void> {
  await click('toggle-entry'); await settled();
  await click('entry-value-trigger');
  // Configure only visible production fields: Happy DOM does not establish the
  // customizable select's initial selected option as a browser does.
  await field('event-duration', 'quarter'); await field('event-dots', '0');
  await click('close-entry-value'); await click('toggle-entry');
  expect(document.body.dataset.entryMode).toBe('true'); expect(document.activeElement).toBe(el('score-editor'));
}
function publish(surface: MusicSurface, diagnostics: readonly Diagnostic[] = surface.diagnostics): void {
  surface.dispatchEvent(new CustomEvent('notation-diagnostics', { bubbles: true, composed: true, detail: { diagnostics } }));
}

beforeEach(async () => {
  for (const attribute of [...document.body.attributes]) document.body.removeAttribute(attribute.name);
  document.body.innerHTML = shell; adapterNotices = () => [];
  vi.stubGlobal('ResizeObserver', ResizeObserverDouble);
  for (const panel of document.querySelectorAll<HTMLElement>('[popover]')) Object.defineProperties(panel, {
    showPopover: { configurable: true, value: undefined }, hidePopover: { configurable: true, value: undefined },
  });
  // Used content width is an explicit environment boundary, never a fit claim.
  const realStyle = globalThis.getComputedStyle.bind(globalThis);
  vi.spyOn(globalThis, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = realStyle(element, pseudo);
    return element.classList.contains('surface') ? new Proxy(style, { get(target, property) {
      return property === 'width' ? '800px' : Reflect.get(target, property, target);
    } }) : style;
  });
  engine.ready.mockReset().mockResolvedValue(); engine.render.mockReset().mockImplementation(draw);
  // MusicSurface imports its adapter dynamically; retain the same boundary on
  // both paths, matching the existing real-component scheduling tests.
  const actual = await vi.importActual<typeof import('../src/engraving/render.js')>('../src/engraving/render.js');
  vi.spyOn(actual, 'engravingReady').mockImplementation(engine.ready); vi.spyOn(actual, 'renderScore').mockImplementation(engine.render);
});
afterEach(async () => {
  app?.dispose(); app = undefined;
  for (const release of releases) release(); releases.clear();
  document.body.replaceChildren(); await nextTask();
  if (vi.isFakeTimers()) { vi.clearAllTimers(); vi.useRealTimers(); }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('notation notices through the actual Author workspace', () => {
  it('moves empty and partial voice notices into Review and tracks completion and musical history exactly', async () => {
    mount(); await settled(); requireNotices(['empty-voice', 'incomplete-measure']);
    expect(surface().score!.staves[0].measures[0].voices[0].events).toHaveLength(0);
    const source = accepted(); await startWriting(); expect(accepted()).toEqual(source);
    expect(el('workspace-feedback-label').textContent).toMatch(/^Click the staff or press Enter to write\./);
    for (let index = 1; index <= 4; index++) {
      await key('Enter'); expect(app!.session.revision).toBe(index);
      expect(app!.session.score.staves[0].measures[0].voices[0].events).toHaveLength(index);
      requireNotices(index === 4 ? [] : ['incomplete-measure']);
      expect(el('author-errors').hidden).toBe(true);
      expect(el('workspace-feedback-label').dataset.feedbackKind).toBe('info');
    }
    expect(el('insert-event-label').textContent).toBe('Add + insert');
    expect(el('insert-event-destination').hidden).toBe(false);
    // Custom printed bar labels do not renumber the command's next appended
    // measure. The palette must describe the actual planned Bar 2, not infer 13.
    expect(el('insert-event-destination').textContent).toBe('Bar 2');
    expect(el('insert-event').title).toContain('Lead, bar 2, voice 1');
    const full = app!.session.project.sourceHtml;
    await click('insert-event'); await settled();
    expect(app!.session.score.staves[0].measures[1].number).toBe('2');
    expect(app!.session.score.staves[0].measures[1].voices[0].events).toHaveLength(1);
    await click('undo'); await settled(); requireNotices([]); expect(app!.session.project.sourceHtml).toBe(full);
    await click('undo'); await settled(); requireNotices(['incomplete-measure']);
    expect(el('insert-event-label').textContent).toBe('Insert here'); expect(el('insert-event-destination').hidden).toBe(true);
    await click('redo'); await settled(); requireNotices([]); expect(app!.session.project.sourceHtml).toBe(full);
  });

  it('keeps notices non-live and inspection read-only without replacing the writing hint or header owner', async () => {
    mount(); await settled(); await startWriting(); const before = accepted(), announcement = feedback();
    const list = el('notation-review-list');
    expect(list.closest('[aria-live], [role="alert"], [role="status"]')).toBeNull();
    expect(list.closest('#workspace-review')).toBe(el('workspace-review'));
    for (let cycle = 0; cycle < 3; cycle++) { publish(surface()); expect(accepted()).toEqual(before); expect(feedback()).toEqual(announcement); }
    requireNotices(['empty-voice', 'incomplete-measure']);
    await click('workspace-review-trigger'); expect(available(list)).toBe(true); expect(el('workspace-review-trigger').textContent).toBe('Review');
    await click('close-workspace-review'); expect(accepted()).toEqual(before); expect(feedback()).toEqual(announcement);
    expect(document.body.dataset.entryMode).toBe('true');
  });

  it('deduplicates exact diagnostics while retaining source, measure, message and print distinctions', async () => {
    adapterNotices = container => container.classList.contains('print') ? [warning, { ...warning }] : [
      warning, { ...warning }, { ...warning, sourceId: 'different-source' },
      { ...warning, measureId: 'different-measure' }, { ...warning, message: 'A different notice for the same event.' },
    ];
    mount(complete); await settled();
    expect(surface().diagnostics).toHaveLength(7);
    requireNotices(['review-fixture', 'review-fixture', 'review-fixture', 'review-fixture', 'print-review-fixture']);
    expect(noticeRows().at(-1)?.textContent).toBe('Print: Fixture engraving notice. [voice]');
    const before = accepted(), announcement = feedback();
    for (let index = 0; index < 4; index++) publish(surface());
    expect(noticeRows()).toHaveLength(5); expect(accepted()).toEqual(before); expect(feedback()).toEqual(announcement);
    adapterNotices = () => []; await surface().refresh(); await nextTask(); requireNotices([]);
    expect(accepted()).toEqual(before); expect(feedback()).toEqual(announcement);
  });

  it('uses text nodes for diagnostic prose and does not accept forged event detail as score diagnostics', async () => {
    adapterNotices = container => container.classList.contains('print') ? [] : [{ ...warning, message: '<img src=x onerror="unsafe()"> is diagnostic text.' }];
    mount(complete); await settled(); const before = accepted();
    expect(noticeRows()).toHaveLength(1); expect(noticeRows()[0].children).toHaveLength(0);
    expect(noticeRows()[0].textContent).toContain('<img src=x onerror="unsafe()">');
    publish(surface(), [{ ...warning, code: 'forged-event-only', message: 'Never supplied by the reader or adapter.' }]);
    requireNotices(['review-fixture']); expect(accepted()).toEqual(before);
  });

  it('suppresses ordinary warnings only on the owned Author surface and leaves standalone component delivery intact', async () => {
    mount(); await settled();
    const owned = surface(), authorPanel = owned.shadowRoot!.querySelector<HTMLDetailsElement>('.diagnostics')!;
    expect(owned.shadowRoot!.querySelectorAll('style[data-author-notation-review]')).toHaveLength(1);
    expect(authorPanel.matches('.diagnostics:not([data-errors])')).toBe(true);
    expect(getComputedStyle(authorPanel).display).toBe('none');
    const holder = document.createElement('div'); holder.innerHTML = empty.replaceAll('id="', 'id="standalone-');
    const standalone = holder.firstElementChild as MusicSurface; document.body.append(standalone); await standalone.refresh();
    const panel = standalone.shadowRoot!.querySelector<HTMLDetailsElement>('.diagnostics')!;
    expect(standalone.shadowRoot!.querySelector('style[data-author-notation-review]')).toBeNull();
    expect(panel.hidden).toBe(false); expect(panel.hasAttribute('data-errors')).toBe(false);
    expect(getComputedStyle(panel).display).not.toBe('none');
    expect(panel.querySelectorAll('li')).toHaveLength(2); requireNotices(['empty-voice', 'incomplete-measure']);
    await click('view-read'); await settled(); await click('view-write'); await settled();
    expect(surface()).toBe(owned); expect(owned.shadowRoot!.querySelectorAll('style[data-author-notation-review]')).toHaveLength(1);
  });

  it.each(['screen', 'print', 'thrown'] as const)('retains the fatal %s component panel and root render error instead of filtering errors into an innocuous warning list', async failure => {
    if (failure === 'thrown') engine.render.mockImplementation(() => { throw new Error('Fixture engraving failure.'); });
    else adapterNotices = container => container.classList.contains(failure) ? [{ ...warning, severity: 'error', code: 'fatal-fixture', message: 'Fixture engraving failure.' }] : [];
    const message = `${failure === 'print' ? 'Print: ' : ''}Fixture engraving failure.`;
    mount(); await settled('error'); const before = accepted();
    const panel = surface().shadowRoot!.querySelector<HTMLDetailsElement>('.diagnostics')!;
    expect(panel.hidden).toBe(false); expect(panel.open).toBe(true); expect(panel.hasAttribute('data-errors')).toBe(true);
    expect(panel.matches('.diagnostics:not([data-errors])')).toBe(false); expect(getComputedStyle(panel).display).not.toBe('none');
    expect(panel.textContent).toContain('Fixture engraving failure.'); expect(surface().getLayoutGeometry()).toBeUndefined();
    expect(el('author-errors').hidden).toBe(false); expect(el('author-errors').textContent).toBe(message);
    expect(el('workspace-review-trigger').textContent).toBe('Review error'); expect(feedback().kind).toBe('error');
    requireNotices(['empty-voice', 'incomplete-measure']);
    publish(surface()); expect(accepted()).toEqual(before); expect(el('author-errors').textContent).toBe(message);
  });

  it.each(['accepted source', 'document replacement'] as const)('clears previous notices immediately and discards superseded engraving after %s changes', async change => {
    mount(); await settled(); requireNotices(['empty-voice', 'incomplete-measure']);
    const owned = surface(), release = holdEngraving();
    if (change === 'accepted source') app!.session.applySource(partial);
    else app!.session.replaceProject(createProject(partial, 'Replacement draft'));
    expect(document.body.dataset.renderState).toBe('rendering'); expect(noticeRows()).toHaveLength(0); expect(el('notation-review').hidden).toBe(true);
    await nextTask();
    if (change === 'accepted source') app!.session.applySource(complete);
    else app!.session.replaceProject(createProject(complete, 'Replacement complete'));
    expect(surface()).toBe(owned); expect(noticeRows()).toHaveLength(0);
    const current = accepted(); release(); await settled(); requireNotices([]); expect(accepted()).toEqual(current);
    expect(surface().score!.staves[0].measures[0].voices[0].events[0].duration).toBe('whole');
  });

  it('does not republish old same-surface notices when a real diagnostic listener accepts newer Source during event delivery', async () => {
    mount(); await settled(); const owned = surface(); requireNotices(['empty-voice', 'incomplete-measure']);
    const abort = new AbortController(); let changed = false; let afterAuthor: (string | undefined)[] | undefined;
    // A real composed component notification reaches capture listeners before
    // Author's target listener. Accepting a newer source there must invalidate
    // this event's old reader result even when the same MusicSurface is reused.
    document.addEventListener('notation-diagnostics', event => {
      if (event.composedPath()[0] !== owned || changed) return;
      changed = true; app!.session.applySource(complete);
      expect(noticeRows()).toHaveLength(0); expect(document.body.dataset.renderState).toBe('rendering');
    }, { capture: true, signal: abort.signal });
    document.addEventListener('notation-diagnostics', event => {
      if (event.composedPath()[0] === owned && afterAuthor === undefined) afterAuthor = codes();
    }, { signal: abort.signal });
    try { await owned.refresh(); await settled(); }
    finally { abort.abort(); }
    expect(changed).toBe(true); expect(surface()).toBe(owned); expect(afterAuthor).toEqual([]);
    requireNotices([]); expect(app!.session.score.staves[0].measures[0].voices[0].events[0].duration).toBe('whole');
  });

  it('ignores events from a replaced or nested surface and stops observing after workspace disposal', async () => {
    mount(); await settled(); const old = surface(); requireNotices(['empty-voice', 'incomplete-measure']);
    app!.session.applySource(`<music-system id="replacement-score">${complete}</music-system>`); await settled();
    expect(surface()).not.toBe(old); expect(old.isConnected).toBe(false); requireNotices([]);
    const before = accepted(); publish(old); expect(noticeRows()).toHaveLength(0); expect(accepted()).toEqual(before);
    const nested = surface().querySelector('music-measure') as MusicSurface;
    publish(nested, [warning]); requireNotices([]); expect(accepted()).toEqual(before);
    const current = surface(); app!.dispose(); app = undefined;
    adapterNotices = () => [warning]; await current.refresh(); publish(current);
    expect(current.diagnostics.length).toBeGreaterThan(0); expect(noticeRows()).toHaveLength(0);
  });

  it('replaces full-score draft notices with the current part’s complete notation', async () => {
    const project = createProject(`<music-system id="parts-score">${empty}${complete.replaceAll('id="', 'id="other-')}</music-system>`, 'Separate part warnings');
    project.parts.push({ id: 'complete-part', label: 'Complete part', staffIds: ['other-lead'] });
    mount(undefined, undefined, project); await settled(); requireNotices(['empty-voice', 'incomplete-measure']);
    const before = accepted(), release = holdEngraving();
    await click('location-trigger'); await field('part-select', 'complete-part');
    expect(noticeRows()).toHaveLength(0); const partInspection = accepted(); release(); await settled(); requireNotices([]);
    expect(surface().score!.staves.map(staff => staff.id)).toEqual(['other-lead']); expect(accepted()).toEqual(partInspection);
    expect(accepted()).toMatchObject({ project: before.project, revision: before.revision, undo: before.undo, redo: before.redo });
    expect(app!.session.selection).toMatchObject({ partId: 'complete-part', sourceId: 'other-bar' });
    await click('close-location'); await click('location-trigger'); await field('part-select', 'score'); await settled();
    requireNotices(['empty-voice', 'incomplete-measure']);
    expect(accepted()).toMatchObject({ project: before.project, revision: before.revision, undo: before.undo, redo: before.redo });
  });

  it('keeps pending-source and rejected-source feedback above ordinary notation notices', async () => {
    mount(); await settled(); await click('source-trigger');
    await field('source-input', partial.replace('duration="quarter"', 'duration="unknown-value"'));
    await click('source-apply');
    expect(app!.session.project.pendingSource).not.toBeNull(); expect(el('author-errors').hidden).toBe(false);
    expect(feedback().title).toMatch(/^Source unapplied/); const before = accepted(), announcement = feedback();
    adapterNotices = container => container.classList.contains('print') ? [] : [warning];
    await surface().refresh(); await nextTask();
    requireNotices(['empty-voice', 'incomplete-measure', 'review-fixture']); expect(accepted()).toEqual(before); expect(feedback()).toEqual(announcement);
    expect(surface().score!.staves[0].measures[0].voices[0].events).toHaveLength(0);
  });

  it('does not overwrite a real pointer refusal while the current render publishes draft warnings', async () => {
    const release = holdEngraving(); mount(); await nextTask(); expect(document.body.dataset.renderState).toBe('rendering');
    const before = accepted();
    el('score-host').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true,
      pointerId: 41, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: 40, clientY: 40 }));
    expect(el('pointer-status').textContent).toBe('Wait for the score to finish engraving.');
    const announcement = feedback(); expect(announcement.kind).toBe('error'); expect(announcement.text).toBe('Wait for the score to finish engraving.');
    release(); await settled(); requireNotices(['empty-voice', 'incomplete-measure']);
    expect(feedback()).toEqual(announcement); expect(accepted()).toEqual(before);
  });

  it('retains recovery failure priority and its backup route when notation notices arrive', async () => {
    // Keep the separate scheduled save from changing a load-failure message
    // midway through this notice-only ownership check under parallel load.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const storage: RecoveryStorage = { getItem: () => { throw new Error('Fixture storage denied.'); }, setItem: () => { throw new Error('Fixture storage denied.'); }, removeItem: () => {} };
    mount(empty, storage); await settled();
    expect(feedback().title).toMatch(/^Local recovery unavailable/); expect(el('workspace-recovery-detail').textContent).toContain('Fixture storage denied.');
    const before = accepted(), announcement = feedback();
    adapterNotices = container => container.classList.contains('print') ? [] : [warning];
    await surface().refresh(); await nextTask(); requireNotices(['empty-voice', 'incomplete-measure', 'review-fixture']);
    expect(feedback()).toEqual(announcement); expect(accepted()).toEqual(before); expect(el('review-download-project').hidden).toBe(false);
  });

  it('Select parks writing-only hints without changing the recipe, bookmark, accepted history message or a later rejection', async () => {
    mount(partial); await settled(); await startWriting();
    for (const cue of [undefined, 'r', 'n', 'ArrowLeft', 'Escape']) {
      if (cue) await key(cue);
      expect(el('author-status').textContent).toMatch(/Click the staff|Writing at|Writing remains active/);
      const before = accepted(), recipe = entryRecipe();
      await click('select-mode');
      expect(document.body.dataset.entryMode).toBe('false'); expect(el('select-mode').getAttribute('aria-pressed')).toBe('true');
      expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('false');
      expect(el('author-status').textContent).toBe(''); expect(el('workspace-feedback-label').textContent).toBe('');
      expect(entryRecipe()).toEqual(recipe); expect(accepted()).toEqual(before);
      await click('toggle-entry'); await settled();
      expect(document.body.dataset.entryMode).toBe('true'); expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true');
      expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
    }
    await key('Enter'); const written = accepted(), committedStatus = el('author-status').textContent;
    expect(committedStatus).toBeTruthy(); expect(committedStatus).not.toMatch(/Click the staff|Writing at|Writing remains active/);
    await click('select-mode'); expect(el('author-status').textContent).toBe(committedStatus); expect(accepted()).toEqual(written);

    await click('toggle-entry'); await settled(); await click('entry-value-trigger'); await field('event-duration', 'whole');
    await click('close-entry-value'); await click('toggle-entry');
    const beforeRejected = accepted(), recipe = entryRecipe(); await key('Enter');
    expect(accepted()).toEqual(beforeRejected); expect(el('author-errors').hidden).toBe(false);
    const rejection = feedback(); expect(rejection.kind).toBe('error'); expect(rejection.text).toBeTruthy();
    await click('select-mode');
    expect(el('author-status').textContent).toBe(''); expect(feedback()).toEqual(rejection);
    expect(entryRecipe()).toEqual(recipe); expect(accepted()).toEqual(beforeRejected);
  });

  it('Read clears the parked writing hint and restores the same writing intent and recipe on return', async () => {
    mount(partial); await settled(); await startWriting();
    for (const cue of [undefined, 'r', 'Escape']) {
      if (cue) await key(cue);
      expect(el('author-status').textContent).toMatch(/Click the staff|Writing remains active/);
      const before = accepted(), recipe = entryRecipe();
      await click('view-read'); await settled();
      expect(document.body.dataset.view).toBe('read'); expect(document.body.dataset.entryMode).toBe('false');
      expect(el('workspace-dock').hidden).toBe(true); expect(el('author-status').textContent).toBe('');
      expect(el('workspace-feedback-label').textContent).toBe(''); expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
      await click('view-write'); await settled();
      expect(document.body.dataset.entryMode).toBe('true'); expect(el('workspace-dock').hidden).toBe(false);
      expect(el('toggle-entry').getAttribute('aria-pressed')).toBe('true'); expect(el('select-mode').getAttribute('aria-pressed')).toBe('false');
      expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
      el('score-editor').focus({ preventScroll: true });
    }
  });

  it('parking into Select or Read removes only the writing hint while persistent recovery feedback retains priority', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const readStorage = vi.fn<RecoveryStorage['getItem']>(() => { throw new Error('Fixture storage denied.'); });
    const storage: RecoveryStorage = { getItem: readStorage, setItem: () => { throw new Error('Fixture storage denied.'); }, removeItem: () => {} };
    mount(empty, storage); await settled(); await startWriting(); await key('r');
    const before = accepted(), recipe = entryRecipe(), recovery = feedback();
    expect(recovery.title).toMatch(/^Local recovery unavailable/); expect(el('author-status').textContent).toMatch(/^Rest ready/);
    expect(recovery.title).toContain('Cannot read local recovery: Fixture storage denied.'); expect(readStorage).toHaveBeenCalledTimes(1);
    await click('select-mode'); expect(el('author-status').textContent).toBe(''); expect(feedback()).toEqual(recovery);
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
    await click('toggle-entry'); await settled(); expect(el('author-status').textContent).toMatch(/^Click the staff/);
    // Loading and saving have distinct failure messages. Drive the real save
    // callback at its exact boundary; a slow parallel run must not decide
    // whether this assertion observes the initial load or the later save.
    await vi.advanceTimersByTimeAsync(299); expect(feedback()).toEqual(recovery); expect(readStorage).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); const failedSave = feedback();
    expect(readStorage).toHaveBeenCalledTimes(2); expect(failedSave.title).toContain('Cannot access local recovery: Fixture storage denied.');
    expect(failedSave).toMatchObject({ kind: 'warning', live: 'polite', error: '', errorHidden: true });
    expect(failedSave.title).toMatch(/^Local recovery unavailable/); expect(failedSave.title).not.toBe(recovery.title);
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
    await click('view-read'); await settled();
    expect(el('author-status').textContent).toBe(''); expect(feedback()).toEqual(failedSave);
    expect(el('review-download-project').hidden).toBe(false); expect(el('workspace-recovery-detail').textContent).toContain('Fixture storage denied.');
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
    await click('view-write'); await settled();
    expect(document.body.dataset.entryMode).toBe('true'); expect(feedback()).toEqual(failedSave);
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
  });

  it('controller feedback boundary gives a current gesture the header while retaining and restoring the previous refusal in Review', async () => {
    mount(partial); await settled(); await startWriting();
    await click('entry-value-trigger'); await field('event-duration', 'whole');
    await click('close-entry-value'); await click('toggle-entry'); await key('Enter');
    const refusal = feedback(); expect(refusal.kind).toBe('error'); expect(refusal.errorHidden).toBe(false); expect(refusal.error).toBeTruthy();
    const before = accepted(), recipe = entryRecipe(), boundary = pointerFeedbackBoundary();
    const proposal = 'Before F4 · Lead, bar 12, voice 1 · 0 whole-note onset. The current pointer proposal preserves the written value and identifies its exact insertion boundary.';
    boundary.announce(proposal, 'gesture');
    expect(document.body.dataset.pointerFeedback).toBe('gesture'); expect(feedback().kind).toBe('gesture');
    expect(feedback().text).toMatch(/^Before F4 · Lead, bar 12, voice 1/); expect(feedback().text!.length).toBeLessThanOrEqual(100);
    expect(feedback().title).toBe(proposal); expect(el('workspace-feedback-label').getAttribute('aria-label')).toBe(proposal);
    expect(el('pointer-status').textContent).toBe(proposal);
    expect(el('author-errors').closest('#workspace-review')).toBe(el('workspace-review'));
    expect(el('author-errors').hidden).toBe(false); expect(el('author-errors').textContent).toBe(refusal.error);
    expect(el('workspace-review-trigger').textContent).toBe('Review error');
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);

    // Public cancellation calls the actual clear() implementation, which
    // downgrades the controller's gesture announcement to ordinary info.
    boundary.cancel('feedback-boundary-end');
    expect(document.body.dataset.pointerFeedback).toBe('selection'); expect(feedback()).toEqual(refusal);
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);

    boundary.announce(proposal, 'gesture'); expect(feedback().title).toBe(proposal);
    const nextRefusal = 'The current proposal no longer fits this voice. Choose a shorter written value.';
    boundary.announce(nextRefusal, 'notice');
    expect(document.body.dataset.pointerFeedback).toBe('notice'); expect(feedback().kind).toBe('error');
    expect(feedback().title).toBe(nextRefusal); expect(el('author-errors').textContent).toBe(nextRefusal);
    expect(el('author-errors').hidden).toBe(false);
    boundary.cancel('feedback-boundary-notice-end');
    expect(feedback().title).toBe(nextRefusal); expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
  });

  it.each(['unapplied Source', 'failed recovery'] as const)('controller feedback boundary cannot override %s with a late gesture or notice', async blocker => {
    const storage: RecoveryStorage | undefined = blocker === 'failed recovery' ? {
      getItem: () => { throw new Error('Fixture storage denied.'); }, setItem: () => { throw new Error('Fixture storage denied.'); }, removeItem: () => {},
    } : undefined;
    mount(partial, storage); await settled(); await startWriting();
    if (blocker === 'unapplied Source') {
      await click('source-trigger'); await field('source-input', partial.replace('pitch="F4"', 'pitch="G4"'));
      expect(app!.session.project.pendingSource).not.toBeNull();
    }
    const before = accepted(), recipe = entryRecipe(), retained = feedback(), boundary = pointerFeedbackBoundary();
    expect(retained.kind).toBe('warning'); expect(retained.title).toMatch(blocker === 'unapplied Source' ? /^Source unapplied/ : /^Local recovery unavailable/);
    // This deliberately exercises a late presentation callback while a blocker
    // owns the UI. It does not claim that the blocker admits any new gesture.
    boundary.announce('F4 · Lead, bar 12, voice 1 · current pointer proposal.', 'gesture');
    expect(feedback()).toEqual(retained); expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
    boundary.cancel('feedback-boundary-blocked-end'); expect(feedback()).toEqual(retained);
    const newNotice = 'This target changed before the pointer action could finish.';
    boundary.announce(newNotice, 'notice');
    expect(feedback()).toMatchObject({ text: retained.text, title: retained.title, kind: 'warning', live: retained.live });
    expect(el('author-errors').hidden).toBe(false); expect(el('author-errors').textContent).toBe(newNotice);
    expect(el(blocker === 'unapplied Source' ? 'review-source' : 'review-download-project').hidden).toBe(false);
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
  });

  it('controller feedback boundary keeps the full-bar forecast after completion and leave, below previews, errors and genuine form drafts', async () => {
    mount(); await settled(); await startWriting();
    await click('entry-settings-trigger'); await field('event-pitch', 'F4'); await click('continuation-enabled');
    expect(el<HTMLInputElement>('continuation-enabled').checked).toBe(true);
    await click('close-entry-settings'); await click('toggle-entry');
    for (let count = 0; count < 4; count++) await key('Enter');
    expect(app!.session.score.staves[0].measures).toHaveLength(1);
    const events = app!.session.score.staves[0].measures[0].voices[0].events;
    expect(events).toHaveLength(4); expect(app!.session.revision).toBe(4);
    const before = accepted(), recipe = entryRecipe(), boundary = pointerFeedbackBoundary();
    const forecast = 'Next with Insert: bar 2 · Lead · voice 1';
    const requireForecast = () => {
      expect(el('entry-destination').hidden).toBe(false); expect(el('entry-destination').textContent).toBe(forecast);
      expect(el('insert-event-label').textContent).toBe('Add + insert'); expect(el('insert-event-destination').textContent).toBe('Bar 2');
      expect(feedback()).toMatchObject({ text: forecast, title: forecast, kind: 'info', errorHidden: true });
      expect(el('workspace-feedback-label').getAttribute('aria-label')).toBe(forecast);
    };
    requireForecast();
    // Accepted events above were written through Author. Only delivery of the
    // controller's completion message is a boundary input, not a claimed drag.
    boundary.announce('Placed F4, quarter · Lead, bar 12, voice 1.', 'info'); requireForecast();
    boundary.cancel('feedback-boundary-complete'); requireForecast();
    el('score-host').dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' })); requireForecast();
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);

    const proposal = 'F4 quarter · Lead, bar 12, voice 1 · before the final written event.';
    boundary.announce(proposal, 'gesture'); expect(feedback()).toMatchObject({ text: proposal, title: proposal, kind: 'gesture' });
    boundary.cancel('feedback-boundary-preview-end'); requireForecast();
    const refusal = 'This voice is full. Use Insert to add the next bar.';
    boundary.announce(refusal, 'notice'); expect(feedback()).toMatchObject({ title: refusal, kind: 'error', errorHidden: false });
    expect(el('author-errors').textContent).toBe(refusal); expect(el('entry-destination').textContent).toBe(forecast);
    boundary.announce('The pointer proposal ended.', 'info'); expect(feedback().title).toBe(refusal);

    // Exercise the actual Author commit callback with a valid no-op. A refused
    // earlier action must not return after a successfully resolved interaction.
    boundary.options.commit({ type: 'set-note-pitch', eventId: events.at(-1)!.id, pitch: 'F4', ties: 'reject' });
    boundary.announce('F4 is unchanged. No edit or undo step was added.', 'info');
    boundary.cancel('feedback-boundary-resolved'); requireForecast();
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);

    await click('document-menu-trigger'); await click('score-setup-trigger'); await field('staff-label', 'Unapplied Lead name');
    await click('close-score-setup'); await click('toggle-entry');
    expect(document.body.dataset.entryMode).toBe('true'); expect(el('entry-destination').textContent).toBe(forecast);
    expect(el('staff-inspector').dataset.draftState).toBe('dirty');
    const draft = feedback(); expect(draft.title).toBe('1 unapplied draft · not saved'); expect(draft.kind).toBe('warning');
    boundary.announce('Placed F4, quarter · Lead, bar 12, voice 1.', 'info'); expect(feedback()).toEqual(draft);
    boundary.announce(proposal, 'gesture'); expect(feedback()).toMatchObject({ title: proposal, kind: 'gesture' });
    expect(el('staff-label')).toHaveProperty('value', 'Unapplied Lead name');
    boundary.cancel('feedback-boundary-draft-end'); expect(feedback()).toEqual(draft);
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
    await click('document-menu-trigger'); await click('score-setup-trigger'); await click('discard-staff-draft'); await click('close-score-setup'); await click('toggle-entry');
    expect(el('staff-inspector').dataset.draftState).toBe('clean'); requireForecast();
    expect(accepted()).toEqual(before); expect(entryRecipe()).toEqual(recipe);
  });
});
