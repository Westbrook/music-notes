import type { MusicSurface } from '../src/components/index.js';
import { add, meterTime, rational } from '../src/model/index.js';
import type { MusicEvent, Score } from '../src/model/types.js';
import { authorActiveElement, authorControlParent, queryAuthorControl } from './author-fixture.js';

interface Fixture {
  frame: HTMLIFrameElement;
  doc: Document;
  view: Window;
  workspace: string;
  printRequests: number;
  printed: PrintSnapshot[];
  confirmationDecision: 'confirm' | 'cancel';
  confirmations: { message: string; decision: 'confirm' | 'cancel' }[];
  stopConfirmations?: () => void;
}
interface PrintSnapshot {
  part: string;
  title: string;
  ready: string | undefined;
  renderState: string | undefined;
  pages: number;
  text: string;
  eventIds: string[];
}
interface Result { name: string; passed: boolean; detail: string }
interface Test { name: string; run: () => Promise<string> }
interface Metrics { workspaces: number; selects: number; pages: number; systems: number; printRequests: number }

const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
const recoveryPrefix = 'music-notes.author.recovery.v1:';
const ownedRecoveryKeys = new Set<string>();
let runToken = '';
let sequence = 0;
let metrics: Metrics = { workspaces: 0, selects: 0, pages: 0, systems: 0, printRequests: 0 };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`);
}

/** A watchdog reports a failure; elapsed time never determines a successful test. */
async function watchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}: did not complete within 20 seconds.`)), 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

/** Observe real DOM/controller state rather than guessing a rendering delay. */
async function waitFor(check: () => boolean, label: string, doc: Document): Promise<void> {
  let observer: MutationObserver | undefined;
  let animation = 0;
  const view = doc.defaultView!;
  try {
    await watchdog(new Promise<void>((resolve, reject) => {
      const inspect = () => {
        try {
          if (check()) resolve();
        } catch (error) { reject(error); }
      };
      const frame = () => { inspect(); animation = view.requestAnimationFrame(frame); };
      observer = new MutationObserver(inspect);
      observer.observe(doc.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
      animation = view.requestAnimationFrame(frame);
      inspect();
    }), label);
  } finally {
    observer?.disconnect();
    view.cancelAnimationFrame(animation);
  }
}

function field<T extends HTMLElement>(fixture: Fixture, selector: string): T {
  const element = queryAuthorControl<T>(fixture.doc, selector);
  assert(element, `The actual Author page is missing ${selector}.`);
  return element;
}

function visible(fixture: Fixture, element: HTMLElement): boolean {
  const style = fixture.view.getComputedStyle(element);
  return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}


/** Follow the actual public pane/popover controls; never reveal a hidden field by mutation. */
function enterAtSelection(fixture: Fixture): void {
  const enter = field<HTMLElement>(fixture, '#toggle-entry');
  if (enter.getAttribute('aria-pressed') === 'true') return;
  // Write notes resumes the remembered destination. Test setup deliberately
  // uses Location → Start writing here to retain its selected target.
  click(fixture, '#start-entry-here');
  assert(enter.getAttribute('aria-pressed') === 'true', 'Start writing here must enable entry at the selected location.');
}

function revealControl(fixture: Fixture, selector: string): HTMLElement {
  const target = field<HTMLElement>(fixture, selector);
  if (visible(fixture, target)) return target;
  const ancestors: HTMLElement[] = [];
  for (let element: HTMLElement | null = target; element; element = authorControlParent(element)) ancestors.push(element);
  const inspector = ancestors.find(element => element.matches('#selection-inspector, #passage-inspector, #annotation-inspector, #measure-inspector'));
  if (inspector) {
    if (inspector.id === 'selection-inspector') {
      if (!visible(fixture, inspector)) {
        const back = field<HTMLElement>(fixture, '#back-to-properties');
        click(fixture, visible(fixture, back) ? '#back-to-properties' : '#edit-selected-event');
      }
    } else {
      const tabs: Record<string, string> = {
        'passage-inspector': 'rhythm', 'annotation-inspector': 'markings', 'measure-inspector': 'measure',
      };
      if (!visible(fixture, field<HTMLElement>(fixture, '#workspace-tools'))) {
        const more = field<HTMLElement>(fixture, '#tools-toggle');
        click(fixture, visible(fixture, more) ? '#tools-toggle' : '#edit-selected-event');
      }
      const tab = '#tool-tab-' + tabs[inspector.id];
      if (!visible(fixture, field<HTMLElement>(fixture, tab))) click(fixture, '#other-tools');
      if (field<HTMLElement>(fixture, tab).getAttribute('aria-selected') !== 'true') click(fixture, tab);
    }
  }
  const popover = ancestors.find(element => element.hasAttribute('popover'));
  if (popover && !popover.matches(':popover-open')) {
    const invokers = [...fixture.doc.querySelectorAll<HTMLButtonElement>(
      '[popovertarget="' + popover.id + '"]:not([popovertargetaction="hide"])')];
    const invoker = invokers.find(button => visible(fixture, button)) ?? invokers[0];
    assert(invoker?.id, popover.id + ' needs a public popover invoker.');
    if (['entry-settings', 'entry-value-chooser', 'entry-direction-chooser'].includes(popover.id) && !visible(fixture, invoker)) {
      assert(fixture.doc.body.dataset.view === 'write', 'New-note options and values must not be exposed outside Write.');
      enterAtSelection(fixture);
    }
    click(fixture, '#' + invoker.id);
  }
  if (!visible(fixture, target) && ['insert-event', 'entry-settings-trigger', 'entry-value-trigger', 'entry-direction-trigger'].includes(target.id)) {
    assert(fixture.doc.body.dataset.view === 'write', 'Entry controls must not be exposed outside Write.');
    enterAtSelection(fixture);
  }
  const disclosures: HTMLDetailsElement[] = [];
  for (const parent of ancestors.slice(1)) {
    if (parent.localName === 'details') disclosures.unshift(parent as HTMLDetailsElement);
  }
  for (const details of disclosures) if (!details.open) {
    const summary = details.querySelector<HTMLElement>(':scope > summary');
    assert(summary && visible(fixture, summary), 'An inline disclosure needs its visible native summary before use.');
    summary.focus(); summary.click();
  }
  assert(visible(fixture, target), selector + ' must be visible after opening its public controls.');
  return target;
}

function closePanel(fixture: Fixture, selector: string): void {
  const panel = field<HTMLElement>(fixture, selector);
  if (panel.localName === 'details') {
    if ((panel as HTMLDetailsElement).open) click(fixture, selector + ' > summary');
    return;
  }
  if (!visible(fixture, panel)) return;
  if (panel.hasAttribute('popover') && !panel.matches(':popover-open')) return;
  const close = panel.querySelector<HTMLButtonElement>(
    '[popovertarget="' + panel.id + '"][popovertargetaction="hide"]');
  assert(close?.id, selector + ' needs its actual Close control.');
  click(fixture, '#' + close.id);
}

function click(fixture: Fixture, selector: string): void {
  const element = revealControl(fixture, selector);
  assert(visible(fixture, element), `${selector} must be visible before operating its actual control.`);
  assert(!('disabled' in element) || !element.disabled, `${selector} is unexpectedly disabled.`);
  element.focus();
  element.click();
}

function disclose(fixture: Fixture, selector: string): void {
  const panel = field<HTMLElement>(fixture, selector);
  if (panel.localName === 'details') {
    if (!(panel as HTMLDetailsElement).open) click(fixture, `${selector} > summary`);
    assert((panel as HTMLDetailsElement).open, `${selector} did not open through its summary control.`);
  } else revealControl(fixture, selector);
  assert(visible(fixture, panel), `${selector} must be visible through its public controls.`);
}

async function openDocumentMenu(fixture: Fixture): Promise<void> {
  const menu = field(fixture, '#document-menu');
  if (menu.dataset.popoverFallback === 'true') {
    const trigger = field(fixture, '#document-menu-trigger');
    assert(visible(fixture, trigger), 'The in-flow Document fallback must retain its visible trigger.');
    if (menu.hidden) click(fixture, '#document-menu-trigger');
    await waitFor(() => !menu.hidden && visible(fixture, menu), 'Open the in-flow Document controls', fixture.doc);
    return;
  }
  equal(menu.getAttribute('popover'), 'auto', 'The Document overlay must use a native auto popover');
  if (!menu.matches(':popover-open')) click(fixture, '#document-menu-trigger');
  await waitFor(() => menu.matches(':popover-open') && visible(fixture, menu), 'Open Document through its native popover invoker', fixture.doc);
}

async function closeDocumentMenu(fixture: Fixture): Promise<void> {
  const menu = field(fixture, '#document-menu');
  if (menu.dataset.popoverFallback === 'true') {
    if (!menu.hidden) click(fixture, '#close-document-menu');
    await waitFor(() => menu.hidden && !visible(fixture, menu), 'Close the in-flow Document controls', fixture.doc);
    return;
  }
  if (!menu.matches(':popover-open')) return;
  click(fixture, '#close-document-menu');
  await waitFor(() => !menu.matches(':popover-open') && !visible(fixture, menu), 'Close Document through its native hide invoker', fixture.doc);
}

function event(fixture: Fixture, element: HTMLElement, name: string): void {
  const change = fixture.doc.createEvent('Event');
  change.initEvent(name, true, false);
  element.dispatchEvent(change);
}

function choose(fixture: Fixture, selector: string, value: string): void {
  const select = revealControl(fixture, selector) as HTMLSelectElement;
  assert(visible(fixture, select), `${selector} must be visible before changing its value.`);
  assert(!select.disabled, `${selector} is unexpectedly disabled.`);
  assert([...select.options].some(option => option.value === value), `${selector} does not offer the value ${JSON.stringify(value)}.`);
  select.focus();
  select.value = value;
  event(fixture, select, 'input');
  event(fixture, select, 'change');
}

function write(fixture: Fixture, selector: string, value: string): void {
  const input = revealControl(fixture, selector) as HTMLInputElement | HTMLTextAreaElement;
  assert(visible(fixture, input), `${selector} must be visible before typing.`);
  assert(!input.disabled, `${selector} is unexpectedly disabled.`);
  input.focus();
  input.value = value;
  event(fixture, input, 'input');
  event(fixture, input, 'change');
}

function check(fixture: Fixture, selector: string, checked: boolean): void {
  const input = revealControl(fixture, selector) as HTMLInputElement;
  assert(visible(fixture, input), `${selector} must be visible before changing it.`);
  if (input.checked !== checked) click(fixture, selector);
  equal(input.checked, checked, `${selector} should retain its chosen state`);
}

function surface(fixture: Fixture): MusicSurface {
  const host = field<HTMLElement>(fixture, '#score-host');
  const root = host.shadowRoot?.querySelector<MusicSurface>('music-system, music-staff');
  assert(root && typeof root.renderComplete?.then === 'function', 'The visible score host must contain a real notation surface in its open shadow root.');
  return root;
}

function score(fixture: Fixture): Score {
  const parsed = surface(fixture).score;
  assert(parsed, 'The actual notation surface did not expose its parsed score.');
  return parsed;
}

function events(fixture: Fixture): MusicEvent[] {
  return scoreEvents(score(fixture));
}

function scoreEvents(parsed: Score): MusicEvent[] {
  return parsed.staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events])));
}

/**
 * A fresh projection legitimately creates fresh implicit model containers.
 * Normalize only those roles, using their persistent source owner as identity.
 * Do not strip IDs by spelling: an author may explicitly use music-auto-* IDs.
 */
function snapshot(fixture: Fixture): string {
  const root = surface(fixture);
  const parsed = score(fixture);
  const persistentId = (id: string, tag: string): string => {
    const source = root.getSource(id);
    assert(source && (source === root || root.contains(source)) && source.id === id && source.localName === tag,
      `The ${tag} model ID ${id} must resolve to its exact persistent source element.`);
    return id;
  };
  let scoreId: string | { implicitRole: string; sourceId: string };
  if (root.localName === 'music-system') scoreId = persistentId(parsed.id, 'music-system');
  else {
    assert(root.localName === 'music-staff' && root.getSource(parsed.id) === root && parsed.id !== root.id,
      'Only a standalone staff’s synthetic score wrapper may have its score identity normalized.');
    scoreId = { implicitRole: 'score', sourceId: root.id };
  }
  const music = {
    ...parsed,
    id: scoreId,
    staves: parsed.staves.map(staff => ({
      ...staff,
      id: persistentId(staff.id, 'music-staff'),
      measures: staff.measures.map(measure => ({
        ...measure,
        id: persistentId(measure.id, 'music-measure'),
        voices: measure.voices.map((voice, index) => {
          const source = root.getSource(voice.id);
          let voiceId: string | { implicitRole: string; sourceId: string; index: number };
          if (source?.localName === 'music-voice') voiceId = persistentId(voice.id, 'music-voice');
          else {
            assert(source === root.getSource(measure.id) && source?.localName === 'music-measure'
              && voice.id !== source.id && measure.voices.length === 1 && index === 0,
            `Only an implicit voice owned by measure ${measure.id} may have its model identity normalized.`);
            voiceId = { implicitRole: 'voice', sourceId: measure.id, index };
          }
          return {
            ...voice,
            id: voiceId,
            events: voice.events.map(item => ({ ...item, id: persistentId(item.id, `music-${item.kind}`) })),
            tuplets: voice.tuplets.map(tuplet => ({ ...tuplet, id: persistentId(tuplet.id, 'music-tuplet') })),
          };
        }),
        annotations: measure.annotations.map(annotation => ({ ...annotation, id: persistentId(annotation.id, `music-${annotation.kind}`) })),
      })),
    })),
  };
  const seen = new Set<string>();
  const sourceNodes = [root, ...root.querySelectorAll('*')].map(element => {
    assert(element.id && !seen.has(element.id), 'Every actual source element must retain a unique persistent ID.');
    seen.add(element.id);
    return { tag: element.localName, id: element.id, parentId: element === root ? null : element.parentElement!.id };
  });
  // This ordered list also retains source-only elements (such as music-meter)
  // and explicit voice wrappers that are otherwise folded into musical values.
  return JSON.stringify({ music, sourceNodes });
}

function noErrors(fixture: Fixture): void {
  const root = surface(fixture);
  const failures = root.diagnostics.filter(diagnostic => diagnostic.severity === 'error');
  assert(failures.length === 0, `The live notation has errors:\n${failures.map(diagnostic => `${diagnostic.code}: ${diagnostic.message}`).join('\n')}`);
  assert(root.shadowRoot?.querySelector('.screen svg'), 'The accepted score must have actual engraved SVG.');
  if (root.diagnostics.some(diagnostic => diagnostic.severity === 'warning')) {
    const panel = root.shadowRoot?.querySelector<HTMLDetailsElement>('.diagnostics');
    assert(panel?.hidden && fixture.view.getComputedStyle(panel).display === 'none',
      'Author must hide the surface warning panel while delivering its warnings through Review.');
  }
}

function publicGeometry(fixture: Fixture): number {
  const root = surface(fixture);
  const parsed = score(fixture);
  const geometry = root.getLayoutGeometry();
  assert(geometry, 'Completed notation must expose current public selection geometry.');
  equal(geometry.revision, root.renderRevision, 'Selection geometry must identify the completed render revision');
  equal(geometry.scoreId, parsed.id, 'Selection geometry must identify its musical score');
  assert(geometry.projectionId.length > 0, 'Selection geometry needs a projection identity.');
  const svgs = [...root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${geometry.projection} .system-row svg`)];
  equal(geometry.systems.length, svgs.length, 'Public geometry must describe every actual SVG system');
  equal(geometry.systems.flatMap(system => system.measures.map(measure => measure.sourceId)).sort(),
    parsed.staves.flatMap(staff => staff.measures.map(measure => measure.id)).sort(), 'Every staff and measure column needs its own selectable measure lane');
  equal(geometry.systems.flatMap(system => system.events.map(item => item.sourceId)).sort(),
    events(fixture).map(item => item.id).sort(), 'Every musical event must remain selectable through its source identity');
  let checked = 0;
  for (const [index, system] of geometry.systems.entries()) {
    const view = svgs[index].viewBox.baseVal;
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      assert(Math.abs(system.viewBox[key] - view[key]) < 0.05, `System ${index + 1}: geometry ${key} must match the actual SVG viewBox.`);
    }
    assert(system.width > 0 && system.height > 0, 'Public geometry must expose finite, nonempty system dimensions.');
    for (const item of [...system.staves, ...system.measures, ...system.events, ...system.annotations, ...system.tuplets, ...system.anchors]) {
      assert(root.getSource(item.sourceId), `Public geometry source ${item.sourceId} must resolve to accepted musical DOM.`);
      assert(Number.isFinite(item.x) && Number.isFinite(item.y), `Public geometry ${item.sourceId} has invalid coordinates.`);
      checked++;
    }
    for (const item of [...system.annotations, ...system.tuplets]) {
      assert(item.x >= view.x - 0.5 && item.y >= view.y - 0.5
        && item.x + item.width <= view.x + view.width + 0.5
        && item.y + item.height <= view.y + view.height + 0.5,
      `Selectable annotation/tuplet ${item.sourceId} must stay inside its actual SVG viewBox.`);
    }
    for (const staff of parsed.staves) for (const measure of staff.measures.slice(system.start, system.end)) {
      for (const voice of measure.voices) {
        const append = system.anchors.find(anchor => anchor.measureId === measure.id
          && anchor.voiceId === voice.id && anchor.eventIndex === voice.events.length);
        assert(append, `Voice ${voice.id} needs an explicit append anchor.`);
        const last = voice.events.at(-1)!;
        const expectedNumerator = BigInt(last.onset.numerator) * BigInt(last.time.denominator)
          + BigInt(last.time.numerator) * BigInt(last.onset.denominator);
        const expectedDenominator = BigInt(last.onset.denominator) * BigInt(last.time.denominator);
        assert(BigInt(append.onset.numerator) * expectedDenominator === expectedNumerator * BigInt(append.onset.denominator),
          `Voice ${voice.id}: append anchor must equal its exact final musical time.`);
      }
    }
  }
  return checked;
}

async function settle(fixture: Fixture): Promise<void> {
  await waitFor(() => fixture.doc.body.dataset.authorReady === 'true'
    && fixture.doc.body.dataset.renderState !== 'rendering', 'Complete the Author controller render', fixture.doc);
  assert(fixture.doc.body.dataset.renderState === 'ready',
    `The Author controller did not reach a ready render: ${field(fixture, '#author-errors').textContent}`);
  await watchdog(fixture.doc.fonts.ready, 'Load the bundled notation fonts');
  await watchdog(surface(fixture).renderComplete, 'Complete the actual notation rendering');
}

function observeFixtureConfirmations(fixture: Fixture): void {
  fixture.stopConfirmations?.();
  const dialog = field<HTMLDialogElement>(fixture, '#author-confirmation');
  const message = field(fixture, '#author-confirmation-message');
  const controls = {
    confirm: field<HTMLButtonElement>(fixture, '#author-confirmation-confirm'),
    cancel: field<HTMLButtonElement>(fixture, '#author-confirmation-cancel'),
  };
  let answered = false;
  const respond = () => {
    if (!dialog.open) { answered = false; return; }
    if (answered || !visible(fixture, dialog)) return;
    const decision = fixture.confirmationDecision;
    const button = controls[decision];
    const text = message.textContent?.trim();
    if (!text || button.disabled || !visible(fixture, button)) return;
    answered = true;
    fixture.confirmations.push({ message: text, decision });
    button.focus(); button.click();
  };
  const observer = new MutationObserver(respond);
  observer.observe(dialog, { attributes: true, childList: true, subtree: true, characterData: true });
  dialog.addEventListener('toggle', respond);
  const view = fixture.view;
  const stop = () => { observer.disconnect(); dialog.removeEventListener('toggle', respond); view.removeEventListener('pagehide', stop); };
  view.addEventListener('pagehide', stop, { once: true });
  fixture.stopConfirmations = stop;
  respond();
}

function configureFixtureResponses(fixture: Fixture): void {
  // Only native printing is intercepted. Destructive-action decisions use the
  // actual in-page dialog and its ordinary visible Confirm/Cancel buttons.
  fixture.view.print = () => {
    fixture.printRequests++;
    metrics.printRequests++;
    const host = field(fixture, '#page-host');
    fixture.printed.push({
      part: field<HTMLSelectElement>(fixture, '#part-select').value,
      title: field<HTMLInputElement>(fixture, '#project-title').value,
      ready: fixture.doc.body.dataset.authorPrintReady,
      renderState: fixture.doc.body.dataset.renderState,
      pages: host.querySelectorAll('.score-page').length,
      text: host.textContent ?? '',
      eventIds: [...host.querySelectorAll<SVGGElement>('g[data-source-id][data-measure-id][data-staff-id][data-x]')]
        .map(group => group.dataset.sourceId!).sort(),
    });
  };
  observeFixtureConfirmations(fixture);
}

async function mount(label: string, width = 1180): Promise<Fixture> {
  const workspace = `test-${runToken}-${++sequence}`;
  const key = `${recoveryPrefix}${workspace}`;
  assert(localStorage.getItem(key) === null, 'A browser fixture must never overwrite an existing recovery key.');
  ownedRecoveryKeys.add(key);
  const article = document.createElement('article');
  article.className = 'fixture';
  const heading = document.createElement('h3');
  heading.textContent = label;
  const note = document.createElement('p');
  note.className = 'fixture-note';
  note.textContent = `Actual /author.html · isolated workspace ${workspace} · no real downloads or print dialogs.`;
  const viewport = document.createElement('div');
  viewport.className = 'viewport';
  const frame = document.createElement('iframe');
  frame.title = label;
  frame.style.width = `${width}px`;
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.src = `/author.html?workspace=${encodeURIComponent(workspace)}`;
  const open = document.createElement('a');
  open.href = frame.src;
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'Open this isolated workspace in a tab';
  note.append(document.createTextNode(' '), open);
  viewport.append(frame);
  article.append(heading, note, viewport);
  fixtures.append(article);
  await watchdog(loaded, 'Load the actual Author entry point');
  const doc = frame.contentDocument;
  const view = frame.contentWindow;
  assert(doc && view, 'Author regression fixtures must remain on the same origin.');
  const fixture: Fixture = { frame, doc, view, workspace, printRequests: 0, printed: [], confirmationDecision: 'confirm', confirmations: [] };
  configureFixtureResponses(fixture);
  await settle(fixture);
  noErrors(fixture);
  metrics.workspaces++;
  return fixture;
}

async function changeMusic(fixture: Fixture, action: () => void, expected: () => boolean, label: string): Promise<void> {
  const revision = fixture.doc.body.dataset.authorRevision;
  action();
  await waitFor(() => fixture.doc.body.dataset.authorRevision !== revision
    && fixture.doc.body.dataset.renderState === 'ready' && expected(), label, fixture.doc);
  await settle(fixture);
  noErrors(fixture);
}

/** Changing the viewed part re-engraves, but must not create an authoring edit. */
async function changeProjection(fixture: Fixture, action: () => void, expected: () => boolean, label: string): Promise<void> {
  const revision = fixture.doc.body.dataset.authorRevision;
  const root = surface(fixture);
  const renderedRevision = root.renderRevision;
  const firstPage = field(fixture, '#page-host').firstElementChild;
  action();
  await waitFor(() => fixture.doc.body.dataset.renderState === 'ready'
    && (surface(fixture) !== root || root.renderRevision !== renderedRevision
      || field(fixture, '#page-host').firstElementChild !== firstPage)
    && expected(), label, fixture.doc);
  await settle(fixture);
  noErrors(fixture);
  equal(fixture.doc.body.dataset.authorRevision, revision, 'A projection choice must not create a musical or metadata history entry');
}

function press(fixture: Fixture, key: string): void {
  const target = authorActiveElement(fixture.doc);
  assert(target && target !== fixture.doc.body, 'Keyboard checks need an actually focused control or score editor.');
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
}

async function sourceApply(fixture: Fixture, source: string): Promise<void> {
  disclose(fixture, '#source-panel');
  write(fixture, '#source-input', source);
  await changeMusic(fixture, () => click(fixture, '#source-apply'),
    () => !/unapplied|pending|invalid/i.test(field(fixture, '#source-status').textContent ?? ''), 'Apply musical HTML as one real edit');
}

async function template(fixture: Fixture, value: 'lead' | 'piano' | 'ensemble'): Promise<void> {
  await openDocumentMenu(fixture);
  choose(fixture, '#new-template', value);
  await changeMusic(fixture, () => click(fixture, '#new-project'),
    () => score(fixture).staves[0].id.startsWith(`${value}-`), `Create the ${value} composition through Document controls`);
  const menu = field(fixture, '#document-menu');
  if (typeof menu.showPopover === 'function') {
    await waitFor(() => !menu.matches(':popover-open'), 'Close the native Document popover after creating the composition', fixture.doc);
  }
}

async function insertNote(fixture: Fixture, pitch: string, duration: string): Promise<void> {
  choose(fixture, '#event-kind', 'note');
  write(fixture, '#event-pitch', pitch);
  choose(fixture, '#event-duration', duration);
  choose(fixture, '#event-dots', '0');
  closePanel(fixture, '#entry-settings');
  closePanel(fixture, '#entry-value-chooser');
  closePanel(fixture, '#location-panel');
  const before = snapshot(fixture);
  await changeMusic(fixture, () => click(fixture, '#insert-event'),
    () => snapshot(fixture) !== before, `Insert ${pitch} ${duration} through the entry strip`);
}

async function openPages(fixture: Fixture): Promise<void> {
  click(fixture, '#view-pages');
  await waitFor(() => fixture.doc.body.dataset.view === 'pages'
    && fixture.doc.body.dataset.renderState === 'ready'
    && field(fixture, '#page-host').querySelector('.score-page') !== null,
  'Compose the physical page preview', fixture.doc);
  await settle(fixture);
}

function pageCoverage(fixture: Fixture, expectedPaper: 'letter' | 'a4', expectedScore = score(fixture)): { pages: number; systems: number } {
  const host = field(fixture, '#page-host');
  const pages = [...host.querySelectorAll<HTMLElement>('.score-page')];
  const systems = [...host.querySelectorAll<HTMLElement>('.page-system')];
  assert(pages.length > 0 && systems.length > 0, 'Pages must contain complete measured systems.');
  equal(host.querySelectorAll('button, input, select, textarea, details, [data-hit-overlay]').length,
    0, 'The physical print surface must not contain editor controls, disclosures, or hit overlays');
  let nextMeasure = 0;
  systems.forEach((system, index) => {
    equal(Number(system.dataset.systemIndex), index, 'Every engraved system must appear once and in order');
    equal(Number(system.dataset.start), nextMeasure, 'Physical page measure ranges must stay contiguous');
    assert(Number(system.dataset.end) > nextMeasure, 'A physical system must contain at least one measure.');
    nextMeasure = Number(system.dataset.end);
    const svg = system.querySelector('svg');
    assert(svg && svg.viewBox.baseVal.width > 0 && svg.viewBox.baseVal.height > 0, 'Each page system needs real vector notation with a nonempty viewBox.');
  });
  equal(nextMeasure, expectedScore.staves[0].measures.length, 'The last physical system must include the last authored measure');
  const eventIds = [...host.querySelectorAll<SVGGElement>('g[data-source-id][data-measure-id][data-staff-id][data-x]')]
    .map(group => group.dataset.sourceId).sort();
  equal(eventIds, scoreEvents(expectedScore).map(item => item.id).sort(), 'Every selected-part musical event must appear exactly once across physical pages');
  const [widthMm, heightMm] = expectedPaper === 'letter' ? [215.9, 279.4] : [210, 297];
  pages.forEach((page, index) => {
    equal(Number(page.dataset.pageIndex), index, 'Physical page numbers must be contiguous');
    const style = fixture.view.getComputedStyle(page);
    const width = Number.parseFloat(style.width);
    const height = Number.parseFloat(style.height);
    assert(Math.abs(width - widthMm * 96 / 25.4) < 2 && Math.abs(height - heightMm * 96 / 25.4) < 2,
      `${expectedPaper} must have physical CSS dimensions, received ${style.width} × ${style.height}.`);
    const sheet = page.getBoundingClientRect();
    const content = page.querySelector<HTMLElement>('.page-content');
    const header = page.querySelector<HTMLElement>('.page-heading');
    const footer = page.querySelector<HTMLElement>('.page-footer');
    assert(content && header && footer, 'Every physical page must reserve space for content, header, and footer.');
    const contentBounds = content.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    const tolerance = 0.75;
    assert(contentBounds.left >= sheet.left - tolerance && contentBounds.right <= sheet.right + tolerance
      && contentBounds.top >= sheet.top - tolerance && contentBounds.bottom <= sheet.bottom + tolerance,
    `Page ${index + 1}: the printable content box must stay inside the physical sheet.`);
    assert(headerBounds.top >= contentBounds.top - tolerance && footerBounds.bottom <= contentBounds.bottom + tolerance,
      `Page ${index + 1}: running furniture must fit within the page margins.`);
    const title = page.querySelector<HTMLElement>('.page-title');
    const musicStart = title?.getBoundingClientRect().bottom ?? headerBounds.bottom;
    let previousBottom = musicStart;
    for (const system of page.querySelectorAll<HTMLElement>('.page-system')) {
      const bounds = system.getBoundingClientRect();
      const svgBounds = system.querySelector('svg')!.getBoundingClientRect();
      assert(bounds.left >= contentBounds.left - tolerance && bounds.right <= contentBounds.right + tolerance,
        `Page ${index + 1}, system ${system.dataset.systemIndex}: notation must fit between the physical margins.`);
      assert(bounds.top >= previousBottom - tolerance && bounds.bottom <= footerBounds.top + tolerance,
        `Page ${index + 1}, system ${system.dataset.systemIndex}: complete systems must not overlap the title, one another, or the footer.`);
      assert(svgBounds.left >= bounds.left - tolerance && svgBounds.right <= bounds.right + tolerance
        && svgBounds.top >= bounds.top - tolerance && svgBounds.bottom <= bounds.bottom + tolerance,
      `Page ${index + 1}, system ${system.dataset.systemIndex}: the actual SVG must fit its planned system box.`);
      previousBottom = bounds.bottom;
    }
  });
  metrics.pages += pages.length;
  metrics.systems += systems.length;
  return { pages: pages.length, systems: systems.length };
}

const tests: Test[] = [
  {
    name: 'Author opens independently with one unwritten draft measure',
    async run() {
      const defaultRecovery = localStorage.getItem(`${recoveryPrefix}default`);
      const fixture = await mount('A blank authoring workspace');
      equal(fixture.doc.body.dataset.view, 'write', 'A fresh workspace must start in Write');
      equal(score(fixture).staves.length, 1, 'Blank authoring has one staff');
      equal(score(fixture).staves[0].clef, 'treble', 'Blank authoring starts in treble clef');
      equal(score(fixture).staves[0].measures.length, 1, 'Blank authoring has one measure');
      equal(events(fixture), [], 'A blank starter contains no authored notes, rests, or hidden replacement music');
      const firstMeasure = score(fixture).staves[0].measures[0];
      equal({ incomplete: firstMeasure.incomplete, pickup: firstMeasure.pickup }, { incomplete: true, pickup: false },
        'The unwritten bar is an ordinary incomplete draft, not silence or a zero-length pickup');
      assert(field<HTMLButtonElement>(fixture, '#undo').disabled && field<HTMLButtonElement>(fixture, '#redo').disabled,
        'New compositions must begin with empty undo and redo history.');
      equal(fixture.doc.querySelectorAll('[data-score]').length, 0, 'The notation workbook demonstrations must not be embedded in Author');
      assert(fixture.doc.querySelector<HTMLAnchorElement>('a[href="/index.html"]'), 'The separate notation workbook remains directly reachable.');
      equal(localStorage.getItem(`${recoveryPrefix}default`), defaultRecovery, 'An isolated fixture must not replace the normal workspace');
      return 'The real author.html entry initializes one genuinely empty ordinary draft bar and independent history without mounting workbook demonstrations or replacing normal recovery.';
    },
  },
  {
    name: 'Document follows its uncovered trigger without reflowing desktop or phone layouts',
    async run() {
      const qualifiedViewports: string[] = [];
      for (const { width, height } of [{ width: 1180, height: 760 }, { width: 390, height: 760 }, { width: 390, height: 360 }, { width: 1180, height: 360 }]) {
        const viewport = `${width}×${height}`;
        const fixture = await mount(`Native Document popover at ${viewport}px`, width);
        if (height !== 760) {
          fixture.frame.style.height = `${height}px`;
          await waitFor(() => fixture.view.innerHeight === height, 'Resize the actual popover fixture to a short viewport', fixture.doc);
          await watchdog(new Promise<void>(resolve => fixture.view.requestAnimationFrame(() => fixture.view.requestAnimationFrame(() => resolve()))),
            'Deliver short-viewport resize and layout observations');
          await settle(fixture);
        }
        const menu = field(fixture, '#document-menu');
        const trigger = field<HTMLButtonElement>(fixture, '#document-menu-trigger');
        const close = field<HTMLButtonElement>(fixture, '#close-document-menu');
        assert(menu.localName !== 'details' && !menu.querySelector(':scope > summary'), 'An overlay menu must not be implemented as an expanding details disclosure.');
        const heading = menu.getAttribute('aria-labelledby');
        assert(heading && fixture.doc.getElementById(heading)?.textContent?.trim(), 'The Document popover needs its visible programmatic heading.');
        assert(!menu.contains(field(fixture, '#source-panel')), 'Document must not own or replace the Source editor surface.');
        if (menu.dataset.popoverFallback === 'true') {
          assert(!menu.hasAttribute('popover') && menu.hidden && visible(fixture, trigger),
            'Without Popover API support, Document must offer its visible managed in-flow toggle.');
          await openDocumentMenu(fixture);
          assert(visible(fixture, close) && fixture.view.getComputedStyle(menu).position === 'static',
            'The fallback must be an ordinary section with a reachable Close action.');
          await closeDocumentMenu(fixture);
          continue;
        }
        equal(menu.getAttribute('popover'), 'auto', 'Document must use the native auto-popover state');
        equal(field(fixture, '#source-panel').getAttribute('popover'), 'auto', 'Source must remain a separate named native popover, not be nested in the Document menu');
        assert(trigger.popoverTargetElement === menu && close.popoverTargetElement === menu,
          'Both native invokers must target the actual Document popover element.');
        equal([trigger.type, trigger.popoverTargetAction, close.type, close.popoverTargetAction],
          ['button', 'toggle', 'button', 'hide'], 'Document controls must use native toggle/hide activation without submitting forms');
        assert(!menu.matches(':popover-open') && !visible(fixture, menu), 'Document must begin closed and absent from the visual layout.');
        const before = snapshot(fixture);
        const positions = () => ['.app-header', '#document-menu-trigger', '#pointer-tools', '#score-scroll', '#score-editor'].map(selector => {
          const bounds = field(fixture, selector).getBoundingClientRect();
          return [bounds.left + fixture.view.scrollX, bounds.top + fixture.view.scrollY, bounds.width, bounds.height];
        });
        const initialPositions = positions();
        const unchangedLayout = (label: string) => {
          positions().forEach((bounds, index) => bounds.forEach((value, dimension) => {
            assert(Math.abs(value - initialPositions[index][dimension]) < 0.75,
              `${viewport}px ${label}: opening or closing Document must not move or resize the composition layout.`);
          }));
        };
        await openDocumentMenu(fixture);
        unchangedLayout('open');
        const bounds = menu.getBoundingClientRect();
        const triggerBounds = trigger.getBoundingClientRect();
        assert(Math.abs(bounds.top - triggerBounds.bottom - 8) < 0.75,
          `${viewport}px: Document must open 8px below its header trigger, not cover it with corner positioning.`);
        const atTrigger = fixture.doc.elementFromPoint(triggerBounds.left + triggerBounds.width / 2,
          triggerBounds.top + triggerBounds.height / 2);
        assert(atTrigger === trigger || !!atTrigger && trigger.contains(atTrigger),
          `${viewport}px: the open menu must leave the actual Document button available for toggling.`);
        assert(bounds.width > 0 && bounds.height > 0 && bounds.left >= -1 && bounds.top >= -1
          && bounds.right <= fixture.view.innerWidth + 1 && bounds.bottom <= fixture.view.innerHeight + 1,
        `${viewport}px: the native Document popover must fit within the actual viewport.`);
        if (height === 360) {
          const content = menu.querySelector<HTMLElement>('.document-menu-content');
          assert(content && content.scrollHeight > content.clientHeight
            && /^(auto|scroll)$/.test(fixture.view.getComputedStyle(content).overflowY),
          'A short viewport must keep the full Document controls available through its actual internally scrolling content.');
          assert(close.getBoundingClientRect().top >= bounds.top && close.getBoundingClientRect().bottom <= bounds.bottom,
            'The Document Close action must remain reachable outside the scrolling content.');
        }
        assert(authorActiveElement(fixture.doc) === trigger || menu.contains(authorActiveElement(fixture.doc)),
          'Opening Document must leave focus at its native invoker or a control inside the popover.');
        choose(fixture, '#new-template', 'piano');
        assert(menu.matches(':popover-open') && visible(fixture, menu), 'Focusing and changing the nested native select must not dismiss the parent Document popover.');
        equal(field<HTMLSelectElement>(fixture, '#new-template').value, 'piano', 'The nested customizable select must retain its chosen native value');
        await closeDocumentMenu(fixture);
        await waitFor(() => authorActiveElement(fixture.doc) === trigger, 'Restore focus to the native Document invoker', fixture.doc);
        unchangedLayout('closed');
        await openDocumentMenu(fixture);
        click(fixture, '#document-menu-trigger');
        await waitFor(() => !menu.matches(':popover-open') && !visible(fixture, menu), 'Toggle Document closed with its native invoker', fixture.doc);
        unchangedLayout('toggled closed');
        equal(snapshot(fixture), before, 'Opening, choosing a template, and closing Document must not edit the composition');
        assert(fixture.doc.documentElement.scrollWidth <= fixture.doc.documentElement.clientWidth + 1,
          `${viewport}px: the popover must not introduce document-level horizontal scrolling.`);
        qualifiedViewports.push(viewport);
      }
      return qualifiedViewports.length
        ? `Native invokers open Document 8px below its uncovered stationary trigger at ${qualifiedViewports.join(', ')}px without reflow, viewport overflow, or score edits; the short panel scrolls internally, close returns focus, and nested select value/focus changes keep the parent open. Native Escape, light dismissal, and picker keyboard behavior require separate trusted-input checks.`
        : 'This browser lacks native popovers; the named Document controls remain usable in normal document flow at desktop and phone widths. Native overlay behavior is not qualified in this browser.';
    },
  },
  {
    name: 'Every dropdown keeps native customizable-select semantics and labels',
    async run() {
      const fixture = await mount('Native customizable dropdowns');
      await template(fixture, 'ensemble');
      const selects = [...fixture.doc.querySelectorAll<HTMLSelectElement>('select')];
      assert(selects.length > 15, 'The check must cover the actual writing, parts, source-navigation, and publishing controls.');
      const supported = CSS.supports('appearance', 'base-select') && CSS.supports('selector(::picker(select))');
      for (const select of selects) {
        assert(select.labels?.length || select.getAttribute('aria-label') || select.getAttribute('aria-labelledby'), `Select #${select.id} needs a programmatic accessible name.`);
        assert(select.options.length > 0, `Select #${select.id} lost its native options.`);
        assert([...select.options].every(option => option.hasAttribute('value')), `Every #${select.id} option must have an explicit value.`);
        const first = select.firstElementChild;
        assert(first?.localName === 'button' && first.getAttribute('type') === 'button'
          && first.querySelector('selectedcontent'), `Select #${select.id} must begin with a non-submitting button and selectedcontent, including dynamically populated controls.`);
        if (supported) {
          equal(fixture.view.getComputedStyle(select).getPropertyValue('appearance'), 'base-select', `#${select.id} opts into native base-select styling`);
        }
        metrics.selects++;
      }
      choose(fixture, '#event-duration', 'sixteenth');
      equal(field<HTMLSelectElement>(fixture, '#event-duration').value, 'sixteenth', 'The native select must preserve its submitted value after a change');
      // Associate the actual controls with a temporary, non-submitting form to
      // qualify native values and disabled exclusion without downloading data.
      const form = fixture.doc.createElement('form');
      form.id = `select-regression-${fixture.workspace}`;
      form.hidden = true;
      const previousForms = selects.map(select => select.getAttribute('form'));
      fixture.doc.body.append(form);
      try {
        selects.forEach(select => select.setAttribute('form', form.id));
        const data = new FormData(form);
        for (const select of selects) {
          assert(select.name, `Select #${select.id} needs a stable native form name.`);
          equal(data.get(select.name), select.disabled ? null : select.value, `#${select.id} retains native form-value semantics`);
        }
        const duration = field<HTMLSelectElement>(fixture, '#event-duration');
        const wasDisabled = duration.disabled;
        try {
          duration.disabled = true;
          assert(!new FormData(form).has(duration.name), 'A disabled customizable select must be excluded by native form serialization.');
        } finally { duration.disabled = wasDisabled; }
      } finally {
        selects.forEach((select, index) => {
          if (previousForms[index] === null) select.removeAttribute('form');
          else select.setAttribute('form', previousForms[index]!);
        });
        form.remove();
      }
      return `${selects.length} named native selects retain explicit option values, native form values/disabled exclusion, and button/selectedcontent structure. ${supported ? 'This browser also applies base-select.' : 'This browser retains the native select fallback; customizable picker styling is unsupported.'}`;
    },
  },
  {
    name: 'The first pitch and duration are editable and exactly undoable',
    async run() {
      const fixture = await mount('First pitch, duration, undo and redo');
      const blank = snapshot(fixture);
      await insertNote(fixture, 'D4', 'eighth');
      const written = events(fixture).find(item => item.kind === 'note');
      assert(written, 'Insert must create the first written note.');
      equal(written.pitches.map(pitch => [pitch.step, pitch.octave, pitch.alter]), [['D', 4, 0]], 'Pitch spelling must remain explicit');
      equal(written.duration, 'eighth', 'The first note uses the chosen written duration');
      equal(written.time, { numerator: 1, denominator: 8 }, 'The first note retains exact musical time');
      assert(!events(fixture).some(item => item.measureRest), 'Initial entry into the unwritten draft must not introduce a placeholder measure rest.');
      const accepted = snapshot(fixture);
      await changeMusic(fixture, () => click(fixture, '#undo'), () => snapshot(fixture) === blank, 'Undo first entry');
      await changeMusic(fixture, () => click(fixture, '#redo'), () => snapshot(fixture) === accepted, 'Redo first entry with the same source IDs');
      await openPages(fixture);
      equal(fixture.doc.body.dataset.authorPrintReady, 'false', 'The unfinished first bar must not be published as a complete score');
      check(fixture, '#print-draft', true);
      await waitFor(() => fixture.doc.body.dataset.authorPrintReady === 'true', 'Prepare explicitly marked draft pages', fixture.doc);
      const pages = [...field(fixture, '#page-host').querySelectorAll('.score-page')];
      assert(pages.length > 0 && pages.every(page => /DRAFT/.test(page.querySelector('.page-footer .draft-stamp')?.textContent ?? '')),
        'Every physical page of an incomplete draft must carry the printed DRAFT footer.');
      pageCoverage(fixture, 'letter');
      return 'A D4 eighth note appears through the entry strip; Undo/Redo preserve every real source ID, pitch spelling, and exact time. The unfinished bar blocks normal publication and appears only with a DRAFT footer when explicitly chosen.';
    },
  },
  {
    name: 'Insert transfers focus, idle Escape keeps writing, and Select stops entry',
    async run() {
      const fixture = await mount('Focused note entry and an explicit way to stop');
      await insertNote(fixture, 'D4', 'eighth');
      equal(authorActiveElement(fixture.doc)?.id, 'score-editor', 'Insert must move focus from its button to the score for the advertised pitch shortcuts');
      equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'Successful insertion must expose the active entry state');
      await changeMusic(fixture, () => press(fixture, 'g'),
        () => events(fixture).filter(item => item.kind === 'note').length === 2, 'Type a second pitch with the score focused');
      equal(events(fixture).filter(item => item.kind === 'note').map(item => item.pitches[0].step),
        ['D', 'G'], 'A–G entry must append the intended explicit pitch');
      const accepted = snapshot(fixture);
      const revision = fixture.doc.body.dataset.authorRevision;
      press(fixture, 'Escape');
      equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'Idle Escape must retain the writing mode');
      equal(snapshot(fixture), accepted, 'Idle Escape must not change the accepted music');
      equal(fixture.doc.body.dataset.authorRevision, revision, 'Idle Escape must not create an edit or history entry');
      click(fixture, '#select-mode');
      equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'false', 'Select must explicitly park note entry');
      equal(field(fixture, '#select-mode').getAttribute('aria-pressed'), 'true', 'Select must expose the active inspection mode');
      press(fixture, 'a');
      await waitFor(() => visible(fixture, field(fixture, '#workspace-feedback-label'))
        && /write notes|entry|insertion/i.test(field(fixture, '#workspace-feedback-label').textContent ?? ''),
        'Explain that pitch entry is no longer active', fixture.doc);
      equal(snapshot(fixture), accepted, 'A pitch key in Select must not silently change the music');
      revealControl(fixture, '#event-kind').focus();
      press(fixture, 'c');
      await settle(fixture);
      equal(snapshot(fixture), accepted, 'Typing inside a native select within the editor must not trigger pitch insertion');
      return 'Insert focuses the score and G appends a note. Idle Escape keeps Write active without changing music; Select parks entry. A pitch key in Select or inside a native dropdown leaves the accepted music unchanged.';
    },
  },
  {
    name: 'Delete and Backspace select written rest glyphs, preserve empty voices, and undo exactly',
    async run() {
      for (const key of ['Delete', 'Backspace']) for (const kind of ['after a note', 'sole ordinary rest', 'sole full-measure rest']) {
        const fixture = await mount(`${key}: ${kind}`);
        if (kind === 'after a note') await insertNote(fixture, 'F4', 'quarter');
        choose(fixture, '#event-kind', 'rest');
        choose(fixture, '#event-duration', 'quarter');
        choose(fixture, '#event-dots', '0');
        choose(fixture, '#insert-position', 'after');
        check(fixture, '#event-measure-rest', kind === 'sole full-measure rest');
        closePanel(fixture, '#entry-settings');
        closePanel(fixture, '#entry-value-chooser');
        closePanel(fixture, '#location-panel');
        await changeMusic(fixture, () => click(fixture, '#insert-event'),
          () => events(fixture).some(item => item.kind === 'rest'), `Write ${kind} through the entry controls`);
        const rest = events(fixture).find(item => item.kind === 'rest')!;
        equal(rest.measureRest, kind === 'sole full-measure rest', 'The fixture must distinguish written duration from a full-measure rest');
        equal(rest.time, kind === 'sole full-measure rest' ? { numerator: 1, denominator: 1 } : { numerator: 1, denominator: 4 },
          'The inserted rest must retain the intended exact musical time');
        const measure = score(fixture).staves[0].measures[0];
        const voiceOwner = surface(fixture).getSource(measure.voices[0].id);
        assert(voiceOwner, 'The rest voice must have a persistent source owner.');
        const survivors = events(fixture).filter(item => item.id !== rest.id);
        equal(survivors.map(item => item.kind), kind === 'after a note' ? ['note'] : [], 'The fixture must contain only its deliberately written music');
        const accepted = snapshot(fixture);
        const acceptedSource = field<HTMLTextAreaElement>(fixture, '#source-input').value;
        const revision = Number(fixture.doc.body.dataset.authorRevision);
        const selectedIds = () => [...field(fixture, '#event-navigator').shadowRoot!.querySelectorAll<HTMLElement>('[data-source-id][aria-pressed="true"]')]
          .map(button => button.dataset.sourceId);

        click(fixture, '#select-mode');
        choose(fixture, '#measure-select', measure.id);
        closePanel(fixture, '#location-panel');
        equal(selectedIds(), [], 'Select the bar first so an ignored rest click cannot inherit an existing event selection');
        // Focus a visible control, never the score: the glyph click must supply
        // the focus needed for Delete instead of inheriting it from Insert.
        field<HTMLButtonElement>(fixture, '#location-trigger').focus();
        equal(authorActiveElement(fixture.doc)?.id, 'location-trigger', 'Rest selection begins with focus outside the score');
        const root = surface(fixture);
        const group = root.shadowRoot?.querySelector<SVGGraphicsElement>(`.screen g[data-source-id="${rest.id}"]`);
        assert(group, 'The written rest needs a rendered group with its exact source ID.');
        // SMuFL text bounds include the font's tall em box. The renderer's
        // measured ink target supplies the actual selectable rest footprint.
        const hitRegion = group.querySelector<SVGRectElement>('rect[opacity="0"][pointer-events="all"]');
        assert(hitRegion, 'The rendered rest needs its measured ink hit region.');
        const bounds = hitRegion.getBoundingClientRect();
        const viewport = field(fixture, '#score-scroll').getBoundingClientRect();
        assert(bounds.width > 0 && bounds.height > 0 && fixture.view.getComputedStyle(hitRegion).visibility !== 'hidden'
          && bounds.left >= viewport.left && bounds.right <= viewport.right && bounds.top >= viewport.top && bounds.bottom <= viewport.bottom,
        'Click the actual visible rest ink inside the score viewport.');
        const clientX = bounds.left + bounds.width / 2, clientY = bounds.top + bounds.height / 2;
        const glyph = root.shadowRoot!.elementFromPoint(clientX, clientY);
        assert(glyph && fixture.doc.elementFromPoint(clientX, clientY) === field(fixture, '#score-host')
          && (glyph === root || root.shadowRoot!.contains(glyph)), 'The rest coordinates must actually hit notation, not an overlay or clipped content.');
        glyph.dispatchEvent(new (fixture.view as Window & typeof globalThis).MouseEvent('click', {
          bubbles: true, composed: true, cancelable: true, detail: 1,
          clientX, clientY,
        }));
        await waitFor(() => selectedIds().length === 1 && selectedIds()[0] === rest.id,
          'The rendered rest click must select the rest rather than its measure', fixture.doc);
        equal(authorActiveElement(fixture.doc)?.id, 'score-editor', 'Fresh rest selection must focus the score without a test-supplied focus call');
        equal(snapshot(fixture), accepted, 'Selecting a rest must not change accepted music');
        equal(Number(fixture.doc.body.dataset.authorRevision), revision, 'Selecting a rest must not create history');

        await changeMusic(fixture, () => press(fixture, key),
          () => !events(fixture).some(item => item.id === rest.id), `${key} the actually selected rest`);
        equal(Number(fixture.doc.body.dataset.authorRevision), revision + 1, `${key} must remove the rest in one edit`);
        equal(events(fixture), survivors, `${key} must retain all unselected music and its exact source IDs`);
        assert(!surface(fixture).querySelector('music-rest') && !field<HTMLTextAreaElement>(fixture, '#source-input').value.includes('<music-rest'),
          'Deleting a rest must not invent a replacement rest in the accepted source.');
        const remaining = score(fixture).staves[0].measures[0];
        equal(score(fixture).staves.map(staff => ({ id: staff.id, measures: staff.measures.map(bar => bar.id) })),
          [{ id: 'blank-staff', measures: [measure.id] }], 'Deleting the last event must retain its staff and measure');
        equal({ id: remaining.id, number: remaining.number, meter: remaining.meter, pickup: remaining.pickup, voices: remaining.voices.length },
          { id: measure.id, number: measure.number, meter: measure.meter, pickup: measure.pickup, voices: measure.voices.length },
          'Deletion must retain the bar number, meter, ordinary-measure intent, and voice count');
        const remainingOwner = surface(fixture).getSource(remaining.voices[0].id);
        equal({ id: remainingOwner?.id, tag: remainingOwner?.localName }, { id: voiceOwner.id, tag: voiceOwner.localName },
          'Deletion must preserve the persistent voice container or implicit voice owner');
        equal(remaining.incomplete, true, 'The remaining or genuinely empty ordinary voice must be marked incomplete');
        if (kind !== 'after a note') equal(remaining.voices[0].events, [], 'Removing the sole rest must leave a genuinely empty voice');

        await changeMusic(fixture, () => click(fixture, '#undo'), () => snapshot(fixture) === accepted, `Undo ${key} once`);
        equal(Number(fixture.doc.body.dataset.authorRevision), revision + 2, 'One Undo must restore the single deletion');
        equal(field<HTMLTextAreaElement>(fixture, '#source-input').value, acceptedSource, 'One Undo must restore the exact accepted source text');
        equal(events(fixture).find(item => item.id === rest.id), rest, 'Undo must restore the rest identity, kind, value, and onset');
        equal(selectedIds(), [rest.id], 'Undo must restore the exact selected rest');
      }
      return 'Both keys remove a clicked rest after F4, a sole ordinary rest, and a sole full-measure rest. The glyph itself supplies selection and score focus; each deletion preserves the bar, meter, voice owner, and unselected music, invents no replacement rest, and one Undo restores exact source, rest identity, and selection.';
    },
  },
  {
    name: 'An overflowing insertion rejects atomically without a history entry',
    async run() {
      const fixture = await mount('Rejecting an overfilled measure');
      const blank = snapshot(fixture);
      await insertNote(fixture, 'C4', 'half');
      const accepted = snapshot(fixture);
      choose(fixture, '#insert-position', 'after');
      write(fixture, '#event-pitch', 'E4');
      choose(fixture, '#event-duration', 'whole');
      closePanel(fixture, '#entry-settings');
      closePanel(fixture, '#entry-value-chooser');
      click(fixture, '#insert-event');
      await waitFor(() => visible(fixture, field(fixture, '#workspace-feedback-label'))
        && visible(fixture, field(fixture, '#workspace-review-trigger'))
        && !!field(fixture, '#author-errors').textContent?.trim(), 'Offer the rejected insertion in the visible header Review control', fixture.doc);
      disclose(fixture, '#workspace-review');
      await waitFor(() => visible(fixture, field(fixture, '#author-errors'))
        && !!field(fixture, '#author-errors').textContent?.trim(), 'Report the rejected overflowing insertion', fixture.doc);
      await settle(fixture);
      equal(snapshot(fixture), accepted, 'A rejected command must leave the accepted source and engraving unchanged');
      noErrors(fixture);
      closePanel(fixture, '#workspace-review');
      await changeMusic(fixture, () => click(fixture, '#undo'), () => snapshot(fixture) === blank, 'Undo skips the rejected transaction');
      return 'Adding a whole note after a half note overfills 4/4 and reports an error. Partial overflow preserves the original engraving and leaves only the successful first entry on the undo stack; it cannot use the separate full-tail Add-and-insert action.';
    },
  },
  {
    name: 'Four complete bars can be written without Source editing',
    async run() {
      const fixture = await mount('Four bars from the visible controls');
      for (const [index, pitch] of ['C4', 'D4', 'E4', 'G4'].entries()) {
        if (index > 0) {
          await changeMusic(fixture, () => click(fixture, '#add-measure'),
            () => score(fixture).staves[0].measures.length === index + 1, `Add measure ${index + 1}`);
        }
        await insertNote(fixture, pitch, 'whole');
      }
      equal(score(fixture).staves[0].measures.map(measure => measure.voices[0].events.map(item => item.pitches[0]?.step)),
        [['C'], ['D'], ['E'], ['G']], 'Each new bar must retain its own intended pitch');
      assert(!visible(fixture, field(fixture, '#source-panel')), 'The four-bar workflow must not require opening Source.');
      for (const measure of score(fixture).staves[0].measures) for (const voice of measure.voices) {
        equal(voice.events.reduce((total, item) => add(total, item.time), rational(0)), meterTime(measure.meter),
          `Every voice in measure ${measure.number} must fill its exact meter`);
      }
      assert(!surface(fixture).diagnostics.some(diagnostic => ['empty-voice', 'incomplete-measure', 'measure-underfull']
        .includes(diagnostic.code.replace(/^print-/, ''))), 'Complete bars must have no short-measure or empty-voice diagnostics.');
      return 'Insert and Add measure produce four bars that fill their exact meters, without Source edits or short/empty-voice diagnostics. Authored draft flags need not be cleared to complete the music.';
    },
  },
  {
    name: 'Adding a voice preserves the existing voice and supports independent entry',
    async run() {
      const fixture = await mount('Independent voices');
      await insertNote(fixture, 'C5', 'whole');
      const originalVoice = JSON.stringify(score(fixture).staves[0].measures[0].voices[0].events);
      disclose(fixture, '#measure-inspector');
      await changeMusic(fixture, () => click(fixture, '#add-voice'),
        () => score(fixture).staves[0].measures[0].voices.length === 2, 'Add a second voice');
      choose(fixture, '#event-voice', '1');
      await insertNote(fixture, 'G4', 'whole');
      const voices = score(fixture).staves[0].measures[0].voices;
      equal(JSON.stringify(voices[0].events), originalVoice, 'Entering voice 2 must not overwrite or reorder voice 1');
      equal(voices[1].events.map(item => [item.kind, item.pitches[0]?.step, item.duration]), [['note', 'G', 'whole']], 'Voice 2 retains its own full-bar note');
      return 'A second voice receives its own G4 while the first voice retains its original C5, IDs, and exact timing.';
    },
  },
  {
    name: 'A selected passage becomes an exact triplet in one undoable edit',
    async run() {
      const fixture = await mount('Range selection and exact tuplets');
      for (const pitch of ['C5', 'D5', 'E5']) await insertNote(fixture, pitch, 'eighth');
      const notes = events(fixture).filter(item => item.kind === 'note');
      equal(notes.length, 3, 'The visible controls create three tuplet candidate notes');
      const before = snapshot(fixture);
      disclose(fixture, '#passage-inspector');
      choose(fixture, '#range-start', notes[0].id);
      choose(fixture, '#range-end', notes[2].id);
      disclose(fixture, '#tuplet-inspector');
      write(fixture, '#tuplet-actual', '3');
      write(fixture, '#tuplet-normal', '2');
      await changeMusic(fixture, () => click(fixture, '#wrap-tuplet'),
        () => score(fixture).staves[0].measures[0].voices[0].tuplets.length === 1, 'Wrap the selected three eighth notes');
      const group = score(fixture).staves[0].measures[0].voices[0].tuplets[0];
      equal([group.actual, group.normal, group.eventIds], [3, 2, notes.map(note => note.id)], 'The tuplet keeps the selected events and explicit ratio');
      equal(events(fixture).filter(item => item.kind === 'note').map(item => item.time),
        notes.map(() => ({ numerator: 1, denominator: 12 })), 'Tuplet event durations use exact rational time');
      await changeMusic(fixture, () => click(fixture, '#undo'), () => snapshot(fixture) === before, 'Undo the entire tuplet conversion');
      return 'Range controls create a 3:2 group of three eighth notes with exact 1/12 durations, and one Undo restores the ungrouped passage.';
    },
  },
  {
    name: 'Source Apply guards the accepted score and blocks publishing pending drafts',
    async run() {
      const fixture = await mount('Guarded source and publication preflight');
      // Preserve the staff/column IDs referenced by the current portable project.
      const initial = score(fixture).staves[0];
      await sourceApply(fixture, `<music-staff id="${initial.id}" clef="treble" meter="4/4"><music-measure id="${initial.measures[0].id}"><music-note id="source-note" pitch="F#4" duration="whole"></music-note></music-measure></music-staff>`);
      const accepted = snapshot(fixture);
      const invalid = '<music-staff><music-measure><music-note pitch="C4" duration="whole"></music-note><music-note pitch="D4" duration="whole"></music-note></music-measure></music-staff>';
      write(fixture, '#source-input', invalid);
      click(fixture, '#source-apply');
      await waitFor(() => !!field(fixture, '#author-errors').textContent?.trim()
        && /unapplied|pending|invalid|not applied/i.test(field(fixture, '#source-status').textContent ?? ''),
      'Keep the rejected source draft visible', fixture.doc);
      await settle(fixture);
      equal(snapshot(fixture), accepted, 'Invalid source must not replace the last accepted score');
      equal(field<HTMLTextAreaElement>(fixture, '#source-input').value, invalid, 'Rejected source must remain editable');
      const notice = field(fixture, '#source-draft-notice');
      const feedback = field(fixture, '#workspace-feedback-label');
      const assertPendingFeedback = (label: string) => {
        assert(visible(fixture, feedback) && /unapplied|pending/i.test(feedback.textContent ?? ''),
          `${label}: the header must visibly identify the unapplied source draft.`);
        assert(visible(fixture, field(fixture, '#workspace-review-trigger')),
          `${label}: the header must retain its public Review action.`);
      };
      assertPendingFeedback('While Source is open');
      closePanel(fixture, '#source-panel');
      assertPendingFeedback('After closing Source');
      disclose(fixture, '#workspace-review');
      assert(visible(fixture, notice) && /unapplied|pending/i.test(notice.textContent ?? ''),
        'Review must expose the full pending-source notice through its public header action.');
      assert(visible(fixture, field(fixture, '#author-errors')), 'Review must expose the rejected Source error.');
      closePanel(fixture, '#workspace-review');
      click(fixture, '#view-read');
      await settle(fixture);
      assertPendingFeedback('Read');
      assert(!visible(fixture, field(fixture, '#source-panel')), 'Read must keep the Source editing surface closed.');
      await openPages(fixture);
      assertPendingFeedback('Pages');
      const printButton = field<HTMLButtonElement>(fixture, '#print-score');
      if (!printButton.disabled) click(fixture, '#print-score');
      await waitFor(() => /source|unapplied|pending/i.test(field(fixture, '#page-preflight').textContent ?? ''),
        'Explain why pending source blocks publishing', fixture.doc);
      equal(fixture.printRequests, 0, 'Normal publishing must not print a stale accepted engraving over pending edits');
      check(fixture, '#print-draft', true);
      if (!printButton.disabled) click(fixture, '#print-score');
      await settle(fixture);
      equal(fixture.printRequests, 0, 'Marking output as Draft must not bypass pending-source rejection');
      click(fixture, '#view-write');
      await settle(fixture);
      disclose(fixture, '#source-panel');
      const unsafe = '<music-staff onclick="void 0"><music-measure><music-rest measure></music-rest></music-measure></music-staff>';
      write(fixture, '#source-input', unsafe);
      click(fixture, '#source-apply');
      await waitFor(() => /attribute|allowed|handler|script/i.test(field(fixture, '#author-errors').textContent ?? ''),
        'Reject executable HTML attributes before mounting', fixture.doc);
      equal(snapshot(fixture), accepted, 'Disallowed source attributes must not enter the score DOM');
      assert(!surface(fixture).querySelector('[onclick]'), 'No executable imported attributes may appear in the mounted notation.');
      click(fixture, '#source-revert');
      await waitFor(() => field<HTMLTextAreaElement>(fixture, '#source-input').value !== unsafe
        && !/unapplied|pending|invalid/i.test(field(fixture, '#source-status').textContent ?? ''), 'Discard the pending source draft', fixture.doc);
      equal(snapshot(fixture), accepted, 'Reverting source must preserve accepted music');
      assert(notice.hidden && !/source unapplied|unapplied source/i.test(feedback.textContent ?? ''),
        'Discarding the pending draft must clear both the Review notice and the header warning.');
      return 'Valid source applies once; overflowing and executable-attribute drafts remain unapplied without changing the score. The header warning and Review action survive closed Source, Read, and Pages; Review exposes full details. Normal and Draft printing stay blocked until Apply or Revert.';
    },
  },
  {
    name: 'Reload restores accepted music, metadata, and an unapplied draft in isolation',
    async run() {
      const fixture = await mount('Recover accepted music and a pending draft');
      const defaultRecovery = localStorage.getItem(`${recoveryPrefix}default`);
      await changeMusic(fixture, () => write(fixture, '#project-title', 'Recovery proof'),
        () => field<HTMLInputElement>(fixture, '#project-title').value === 'Recovery proof', 'Commit the typed composition metadata');
      await insertNote(fixture, 'G4', 'half');
      const accepted = snapshot(fixture);
      disclose(fixture, '#source-panel');
      const pending = '<music-staff><music-measure>unfinished source';
      write(fixture, '#source-input', pending);
      const recoveryKey = `${recoveryPrefix}${fixture.workspace}`;
      await waitFor(() => {
        const saved = localStorage.getItem(recoveryKey);
        return !!saved?.includes('Recovery proof') && saved.includes(pending);
      }, 'Autosave accepted music and the pending source text', fixture.doc);
      const loaded = new Promise<void>(resolve => fixture.frame.addEventListener('load', () => resolve(), { once: true }));
      fixture.view.location.reload();
      await watchdog(loaded, 'Reload the actual isolated Author route');
      assert(fixture.frame.contentDocument && fixture.frame.contentWindow, 'Reload must preserve the same-origin fixture.');
      fixture.doc = fixture.frame.contentDocument;
      fixture.view = fixture.frame.contentWindow;
      configureFixtureResponses(fixture);
      await settle(fixture);
      equal(field<HTMLInputElement>(fixture, '#project-title').value, 'Recovery proof', 'Composition metadata survives reload');
      equal(snapshot(fixture), accepted, 'Accepted music and stable source identities survive reload');
      equal(field<HTMLTextAreaElement>(fixture, '#source-input').value, pending, 'Unapplied invalid source text survives reload separately');
      assert(/unapplied|pending|invalid|not applied/i.test(field(fixture, '#source-status').textContent ?? ''), 'Recovery must clearly identify the unapplied draft.');
      const feedback = field(fixture, '#workspace-feedback-label');
      assert(visible(fixture, feedback) && /unapplied|pending/i.test(feedback.textContent ?? ''),
        'Reloaded pending source must retain its visible header warning.');
      disclose(fixture, '#workspace-review');
      assert(visible(fixture, field(fixture, '#source-draft-notice')), 'Review must expose the recovered pending-source notice.');
      closePanel(fixture, '#workspace-review');
      equal(localStorage.getItem(`${recoveryPrefix}default`), defaultRecovery, 'Recovery tests must not alter the normal workspace');
      return 'Reloading the real route restores the accepted G4, title, source identities, and separately retained invalid draft; the normal recovery key stays unchanged.';
    },
  },
  {
    name: 'The lead sheet template distinguishes notes, open slashes, and prescribed rhythm',
    async run() {
      const fixture = await mount('Lead sheet: written head, open vamp and rhythmic cue');
      await insertNote(fixture, 'D4', 'quarter');
      const beforeCancel = { music: snapshot(fixture), source: field<HTMLTextAreaElement>(fixture, '#source-input').value,
        revision: fixture.doc.body.dataset.authorRevision,
        history: [field<HTMLButtonElement>(fixture, '#undo').disabled, field<HTMLButtonElement>(fixture, '#redo').disabled] };
      await openDocumentMenu(fixture); choose(fixture, '#new-template', 'lead');
      const currentTitle = field<HTMLInputElement>(fixture, '#project-title').value || 'Untitled composition';
      const templateName = field<HTMLSelectElement>(fixture, '#new-template').selectedOptions[0]?.textContent?.trim();
      assert(templateName, 'The chosen template must have a visible name.');
      fixture.confirmationDecision = 'cancel';
      const previousConfirmations = fixture.confirmations.length;
      click(fixture, '#new-project');
      await waitFor(() => fixture.confirmations.length === previousConfirmations + 1
        && !field<HTMLDialogElement>(fixture, '#author-confirmation').open,
      'Cancel composition replacement through its actual in-page dialog', fixture.doc);
      await settle(fixture);
      equal(fixture.confirmations.at(-1)?.decision, 'cancel', 'The fixture must activate the real Cancel control');
      const replacementMessage = fixture.confirmations.at(-1)?.message ?? '';
      assert(/replace/i.test(replacementMessage) && replacementMessage.includes(currentTitle) && replacementMessage.includes(templateName),
        'The in-page confirmation must name the current composition and the chosen replacement template.');
      equal({ music: snapshot(fixture), source: field<HTMLTextAreaElement>(fixture, '#source-input').value,
        revision: fixture.doc.body.dataset.authorRevision,
        history: [field<HTMLButtonElement>(fixture, '#undo').disabled, field<HTMLButtonElement>(fixture, '#redo').disabled] },
      beforeCancel, 'Cancelling replacement must preserve accepted source, musical identities, revision, and Undo/Redo availability');
      fixture.confirmationDecision = 'confirm';
      await template(fixture, 'lead');
      equal(fixture.confirmations.length, previousConfirmations + 2, 'The replacement must require a second explicit in-page decision after cancellation');
      equal(fixture.confirmations.at(-1)?.decision, 'confirm', 'The actual Confirm control must authorize the replacement');
      equal(score(fixture).staves.length, 1, 'The lead sheet has one staff');
      equal(score(fixture).staves[0].measures.length, 12, 'The complete lead example has an eight-bar head, two-bar vamp, cue, and out');
      const written = events(fixture);
      assert(written.some(item => item.kind === 'note')
        && written.some(item => item.kind === 'slash' && !item.rhythmic)
        && written.some(item => item.kind === 'slash' && item.rhythmic), 'The template must preserve all three degrees of specification.');
      const annotations = score(fixture).staves[0].measures.flatMap(measure => measure.annotations);
      assert(annotations.some(annotation => annotation.kind === 'harmony')
        && annotations.some(annotation => annotation.kind === 'direction' && /cue/i.test(annotation.text)), 'The open vamp needs harmonic and exit intent in ordinary notation.');
      return 'Cancelling the in-page replacement retains the authored D4 and its complete source/history; confirming a new request loads the twelve-bar study with separate written notes, open slashes, rhythmic slashes, harmony, and cue instructions.';
    },
  },
  {
    name: 'The piano template retains a two-staff part, independent voices, and nested tuplets',
    async run() {
      const fixture = await mount('Piano: grouped staves and nested rhythm');
      await template(fixture, 'piano');
      equal(score(fixture).staves.length, 2, 'Piano loads as two staves');
      equal(score(fixture).bracket, 'brace', 'Piano retains its authored brace');
      assert(score(fixture).staves[0].measures.every(measure => measure.voices.length === 2), 'The piano upper staff keeps both authored voices.');
      assert(events(fixture).some(item => item.tupletIds.length === 2), 'The actual template must engrave its nested tuplet passage.');
      const geometryChecks = publicGeometry(fixture);
      await changeProjection(fixture, () => choose(fixture, '#part-select', 'piano'),
        () => /authored pitch/i.test(score(fixture).label), 'Select the grouped piano part');
      equal(score(fixture).staves.length, 2, 'Selecting the piano part must keep both hands');
      return `The piano sketch retains its brace, two authored voices, exact nested tuplets, and a single part containing both staves at authored pitch. ${geometryChecks} public geometry records resolve to musical source, with exact append anchors and SVG bounds.`;
    },
  },
  {
    name: 'A lower ensemble part receives shared tempo and rehearsals without staff-local directions',
    async run() {
      const fixture = await mount('Ensemble and shared instructions in the cello part');
      await template(fixture, 'ensemble');
      equal(score(fixture).staves.length, 3, 'The ensemble contains all three authored staves');
      equal(score(fixture).staves[0].measures[0].meter.groups, [2, 2, 3], 'The additive 7/8 grouping is retained');
      publicGeometry(fixture);
      const fullSource = field<HTMLTextAreaElement>(fixture, '#source-input').value;
      await changeProjection(fixture, () => choose(fixture, '#part-select', 'cello'),
        () => score(fixture).staves.length === 1 && score(fixture).staves[0].id === 'ensemble-cello', 'Project the cello part');
      equal(field<HTMLSelectElement>(fixture, '#staff-select').value, 'ensemble-cello', 'The writing cursor must move onto a staff present in the chosen part');
      equal(field<HTMLSelectElement>(fixture, '#measure-select').value, 'ensemble-cello-m1', 'Part selection must keep the same measure column on the visible staff');
      assert(/Cello/.test(field(fixture, '#selection-context').textContent ?? ''), 'The visible selection announcement must identify the cello rather than an omitted staff.');
      assert([...field<HTMLSelectElement>(fixture, '#staff-select').options].every(option => option.value === 'ensemble-cello'), 'The staff picker in a cello projection must not offer hidden staves as editing targets.');
      const annotations = score(fixture).staves[0].measures.flatMap(measure => measure.annotations);
      assert(annotations.some(annotation => annotation.id === 'ensemble-tempo' && annotation.kind === 'tempo'), 'The cello part must inherit the top staff’s ensemble tempo.');
      equal(annotations.filter(annotation => annotation.kind === 'rehearsal').map(annotation => annotation.text), ['A', 'B'], 'The cello part must retain both shared rehearsal marks');
      assert(!annotations.some(annotation => annotation.id === 'ensemble-flute-instruction'
        || annotation.id === 'ensemble-vibes-instruction'), 'Other players’ local instructions must not leak into the cello part.');
      equal(field<HTMLTextAreaElement>(fixture, '#source-input').value, fullSource, 'Selecting a part must not copy resolved instructions into the authoritative source');
      await openPages(fixture);
      const coverage = pageCoverage(fixture, 'letter');
      const printed = field(fixture, '#page-host').textContent ?? '';
      assert(printed.includes('Light, in 2 + 2 + 3'), 'The inherited tempo marking must also appear on the physical part pages.');
      return `The authored-pitch cello projection moves the cursor onto its visible staff, includes shared tempo and both rehearsal marks, excludes other players’ private directions, and retains all events across ${coverage.pages} physical page(s) without adding an edit to history.`;
    },
  },
  {
    name: 'Typed metadata survives immediate part navigation before autosave',
    async run() {
      const fixture = await mount('Keep a title while changing the viewed part');
      await template(fixture, 'ensemble');
      const source = field<HTMLTextAreaElement>(fixture, '#source-input').value;
      const revision = fixture.doc.body.dataset.authorRevision;
      write(fixture, '#project-title', 'Keep this idea');
      choose(fixture, '#part-select', 'cello');
      equal(field<HTMLInputElement>(fixture, '#project-title').value, 'Keep this idea', 'Synchronizing the new part must not overwrite the still-pending metadata field');
      await waitFor(() => fixture.doc.body.dataset.authorRevision !== revision
        && fixture.doc.body.dataset.renderState === 'ready'
        && fixture.doc.title.startsWith('Keep this idea')
        && score(fixture).staves.length === 1 && score(fixture).staves[0].id === 'ensemble-cello',
      'Commit the retained title after immediate part navigation', fixture.doc);
      await settle(fixture);
      equal(field<HTMLInputElement>(fixture, '#project-title').value, 'Keep this idea', 'The debounced metadata commit must preserve the author’s typed title');
      equal(field<HTMLTextAreaElement>(fixture, '#source-input').value, source, 'Metadata and projection selection must not change the musical source');
      const key = `${recoveryPrefix}${fixture.workspace}`;
      await waitFor(() => !!localStorage.getItem(key)?.includes('Keep this idea'), 'Save the retained metadata into this isolated recovery', fixture.doc);
      return 'A title typed immediately before a part switch survives control synchronization, the debounced metadata commit, and local recovery without changing the musical source.';
    },
  },
  {
    name: 'Read hides editing and preserves musical identity while navigating',
    async run() {
      const fixture = await mount('A quiet performer reading view', 760);
      await template(fixture, 'lead');
      const before = snapshot(fixture);
      click(fixture, '#view-read');
      await waitFor(() => fixture.doc.body.dataset.view === 'read' && fixture.doc.body.dataset.renderState === 'ready', 'Enter the actual Read view', fixture.doc);
      await settle(fixture);
      assert(!visible(fixture, field(fixture, '#write-tools')), 'Read must hide the writing controls.');
      const entryControls = ['#event-kind', '#event-duration', '#insert-event'];
      for (const selector of entryControls) assert(!visible(fixture, field(fixture, selector)), `Read must hide ${selector}.`);
      const measures = score(fixture).staves[0].measures;
      choose(fixture, '#read-measure', measures[4].id);
      click(fixture, '#read-go');
      await waitFor(() => /5/.test(field(fixture, '#read-location').textContent ?? ''), 'Navigate to measure 5', fixture.doc);
      equal(snapshot(fixture), before, 'Reading navigation must not mutate musical source');
      click(fixture, '#view-write');
      await settle(fixture);
      equal(field<HTMLSelectElement>(fixture, '#measure-select').value, measures[4].id, 'Returning to Write must restore the reader’s musical location');
      assert(visible(fixture, field(fixture, '#pointer-tools')), 'Write must restore its score-local controls.');
      equal(field(fixture, '#select-mode').getAttribute('aria-pressed'), 'true', 'Returning from Read must start in Select rather than silently resume entry.');
      enterAtSelection(fixture);
      for (const selector of ['#entry-settings-trigger', '#entry-value-trigger', '#insert-event']) {
        assert(visible(fixture, field(fixture, selector)), `Explicit writing must restore the ${selector} palette action.`);
      }
      // Event type and value live in separate native popovers. Follow their
      // public invokers rather than requiring the fields to stay on the palette.
      for (const selector of entryControls) {
        assert(visible(fixture, revealControl(fixture, selector)), `Explicit writing must make ${selector} reachable through its public controls.`);
      }
      closePanel(fixture, '#entry-settings'); closePanel(fixture, '#entry-value-chooser');
      equal(snapshot(fixture), before, 'Returning to Write and deliberately enabling entry must not change the accepted music');
      return 'The Read view hides editing, navigates by a named measure, and returns to the same musical location without changing score identity or content.';
    },
  },
  {
    name: 'Selecting a shared instruction in Read keeps the performer in the chosen part',
    async run() {
      const fixture = await mount('Read a shared rehearsal mark in the cello part');
      await template(fixture, 'ensemble');
      await changeProjection(fixture, () => choose(fixture, '#part-select', 'cello'),
        () => score(fixture).staves.length === 1 && score(fixture).staves[0].id === 'ensemble-cello', 'Choose the cello before reading');
      click(fixture, '#view-read');
      await settle(fixture);
      const accepted = snapshot(fixture);
      const revision = fixture.doc.body.dataset.authorRevision;
      const rehearsal = surface(fixture).shadowRoot?.querySelector<SVGGraphicsElement>('.screen g[data-source-id="ensemble-rehearsal-b"]');
      assert(rehearsal, 'The rendered cello part must expose its inherited rehearsal B.');
      const bounds = rehearsal.getBoundingClientRect();
      assert(bounds.width > 0 && bounds.height > 0, 'The inherited rehearsal mark must be visibly engraved before selection.');
      rehearsal.dispatchEvent(new MouseEvent('click', {
        bubbles: true, composed: true, cancelable: true,
        clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2,
      }));
      await waitFor(() => field<HTMLSelectElement>(fixture, '#read-measure').value === 'ensemble-cello-m3',
        'Anchor the shared instruction to the visible part’s measure', fixture.doc);
      await settle(fixture);
      equal(field<HTMLSelectElement>(fixture, '#part-select').value, 'cello', 'Selecting an inherited instruction must not switch to Full score');
      equal(field<HTMLSelectElement>(fixture, '#staff-select').value, 'ensemble-cello', 'Read selection must stay on the visible performer’s staff');
      assert(/Cello/.test(field(fixture, '#read-location').textContent ?? ''), 'The reading announcement must retain the performer’s part.');
      equal(fixture.doc.body.dataset.authorRevision, revision, 'Selecting an inherited instruction must not create an authoring edit');
      equal(snapshot(fixture), accepted, 'Selecting a shared instruction must not mutate or replace the part notation');
      return 'Clicking the actual inherited rehearsal B selects cello measure 3 while preserving the chosen part, reading view, source revision, and notation.';
    },
  },
  {
    name: 'Narrow writing stays usable and Read rewraps only after an explicit refit',
    async run() {
      const fixture = await mount('A 390px writing viewport and deliberate reading refit', 390);
      const noDocumentOverflow = (label: string) => {
        assert(fixture.doc.documentElement.scrollWidth <= fixture.doc.documentElement.clientWidth + 1,
          `${label}: a narrow Author viewport must not cause document-level horizontal overflow.`);
      };
      noDocumentOverflow('Blank Write');
      for (const selector of ['#event-kind', '#event-pitch', '#event-duration', '#insert-event', '#add-measure', '#view-read']) {
        const control = revealControl(fixture, selector);
        control.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        const bounds = control.getBoundingClientRect();
        assert(visible(fixture, control) && bounds.left >= -1 && bounds.right <= fixture.view.innerWidth + 1,
          `${selector} must remain reachable within the narrow viewport.`);
      }
      closePanel(fixture, '#entry-settings'); closePanel(fixture, '#entry-value-chooser'); closePanel(fixture, '#location-panel');
      await template(fixture, 'lead');
      noDocumentOverflow('Lead sheet Write');
      choose(fixture, '#measure-select', 'lead-m5');
      click(fixture, '#view-read');
      await settle(fixture);
      const root = surface(fixture);
      const narrowWidth = root.style.width;
      const grouping = () => {
        const geometry = surface(fixture).getLayoutGeometry();
        assert(geometry, 'The completed Read view must expose its actual system grouping.');
        return geometry.systems.map(system => ({ start: system.start, end: system.end, width: system.width, height: system.height }));
      };
      const narrowGrouping = grouping();
      fixture.frame.style.width = '900px';
      await waitFor(() => fixture.view.innerWidth === 900, 'Resize the actual iframe viewport to 900px', fixture.doc);
      await watchdog(new Promise<void>(resolve => fixture.view.requestAnimationFrame(() => fixture.view.requestAnimationFrame(() => resolve()))),
        'Deliver viewport and ResizeObserver layout updates');
      await settle(fixture);
      equal(root.style.width, narrowWidth, 'Changing the window must not silently replace the captured reading width');
      equal(grouping(), narrowGrouping, 'The performer’s system grouping must stay fixed across the viewport resize');
      equal(field<HTMLSelectElement>(fixture, '#read-measure').value, 'lead-m5', 'A resize must retain the performer’s musical location');
      const revision = root.renderRevision;
      click(fixture, '#read-refit');
      await waitFor(() => fixture.doc.body.dataset.renderState === 'ready'
        && root.renderRevision !== revision && root.style.width !== narrowWidth, 'Refit the reading score through its visible control', fixture.doc);
      await settle(fixture);
      assert(JSON.stringify(grouping().map(system => [system.start, system.end]))
        !== JSON.stringify(narrowGrouping.map(system => [system.start, system.end])), 'An explicit wider refit must actually rewrap this lead sheet.');
      equal(field<HTMLSelectElement>(fixture, '#read-measure').value, 'lead-m5', 'Explicit refit must retain the selected measure');
      noDocumentOverflow('Refitted Read');
      fixture.frame.style.width = '390px';
      await waitFor(() => fixture.view.innerWidth === 390, 'Return the actual viewport to 390px', fixture.doc);
      await openPages(fixture);
      noDocumentOverflow('Narrow physical Pages');
      const pageHost = field(fixture, '#page-host');
      assert(pageHost.scrollWidth > pageHost.clientWidth, 'Physical sheets wider than a phone must scroll inside their own preview container.');
      return 'Writing controls fit 390px. Reading keeps its captured systems and measure 5 after expansion to 900px; Refit deliberately rewraps without losing place. Physical pages scroll inside their preview at phone width.';
    },
  },
  {
    name: 'Pages offers a visible measure choice for independent line and page boundaries',
    async run() {
      const fixture = await mount('Choose a physical page boundary without leaving Pages');
      await template(fixture, 'lead');
      const acceptedSource = field<HTMLTextAreaElement>(fixture, '#source-input').value;
      await openPages(fixture);
      disclose(fixture, '#break-inspector');
      choose(fixture, '#page-measure-select', 'lead-m9');
      await waitFor(() => /9/.test(field(fixture, '#page-selection-context').textContent ?? ''),
        'Announce the selected page-layout measure', fixture.doc);
      choose(fixture, '#layout-break', 'page');
      await changeMusic(fixture, () => click(fixture, '#apply-break'),
        () => [...field(fixture, '#page-host').querySelectorAll('.score-page')]
          .some(page => page.querySelector<HTMLElement>('.page-system')?.dataset.start === '8'),
        'Begin measure 9 on a new physical page');
      equal(fixture.doc.body.dataset.view, 'pages', 'Choosing a boundary must not require returning to Write');
      const coverage = pageCoverage(fixture, 'letter');
      assert(coverage.pages >= 2, 'A forced page break must create another physical page.');
      equal(field<HTMLTextAreaElement>(fixture, '#source-input').value, acceptedSource, 'A layout-profile choice must not rewrite the musical source');
      equal(field<HTMLSelectElement>(fixture, '#page-measure-select').value, 'lead-m9', 'Applying a boundary must retain the visible musical location');
      click(fixture, '#view-write');
      await settle(fixture);
      equal(field<HTMLSelectElement>(fixture, '#measure-select').value, 'lead-m9', 'Write must return to the measure chosen in Pages');
      return 'Pages selects measure 9 directly, begins it on a new sheet, retains the musical source, and returns to that same measure in Write.';
    },
  },
  {
    name: 'Letter and A4 physical pages contain every system once and no editor controls',
    async run() {
      const fixture = await mount('Inspectable Letter and A4 physical page composition');
      await template(fixture, 'lead');
      await openPages(fixture);
      disclose(fixture, '#paper-inspector');
      write(fixture, '#page-max-measures', '1');
      const counts: string[] = [];
      for (const paper of ['letter', 'a4'] as const) {
        choose(fixture, '#page-paper', paper);
        await changeMusic(fixture, () => click(fixture, '#apply-pages'),
          () => field(fixture, '#page-host').querySelectorAll('.page-system').length === 12, `Compose all twelve systems on ${paper}`);
        const coverage = pageCoverage(fixture, paper);
        assert(coverage.pages > 1, 'The physical pagination check must exercise more than one page.');
        equal(coverage.systems, 12, 'The requested one-measure maximum must yield twelve complete systems');
        counts.push(`${paper}: ${coverage.pages} pages / ${coverage.systems} systems`);
      }
      return `${counts.join('; ')}. Exact physical CSS dimensions, contiguous system ranges, every event, and containment between margins/title/footer are retained without editor controls. This checks page composition, not a saved PDF.`;
    },
  },
  {
    name: 'Metadata and part changes invalidate stale pages before a print request',
    async run() {
      const fixture = await mount('Printing uses the latest title and selected part');
      await template(fixture, 'ensemble');
      const fullScore = score(fixture);
      const celloScore = { ...fullScore, staves: fullScore.staves.filter(staff => staff.id === 'ensemble-cello') };
      await openPages(fixture);
      pageCoverage(fixture, 'letter', fullScore);
      if (fixture.doc.body.dataset.authorPrintReady !== 'true') check(fixture, '#ack-layout-warnings', true);
      assert(fixture.doc.body.dataset.authorPrintReady === 'true', `The complete ensemble must be ready before testing invalidation: ${field(fixture, '#page-preflight').textContent}`);
      write(fixture, '#project-title', 'Fresh metadata proof');
      equal(fixture.doc.body.dataset.authorPrintReady, 'false', 'Typing new metadata must immediately invalidate stale print pages, before a debounce finishes');
      if (field<HTMLButtonElement>(fixture, '#print-score').disabled) {
        await waitFor(() => !field<HTMLButtonElement>(fixture, '#print-score').disabled, 'Enable printing only after the updated metadata is composed', fixture.doc);
      }
      click(fixture, '#print-score');
      await waitFor(() => fixture.printRequests === 1, 'Prepare the latest metadata before requesting print', fixture.doc);
      await settle(fixture);
      const first = fixture.printed[0];
      equal([first.ready, first.renderState, first.title], ['true', 'ready', 'Fresh metadata proof'], 'The print boundary must observe completed current metadata');
      assert(first.text.includes('Fresh metadata proof'), 'The actual printed page title must contain the newly typed metadata.');
      equal(first.eventIds, scoreEvents(fullScore).map(item => item.id).sort(), 'The first print request must still contain the full selected ensemble');
      choose(fixture, '#part-select', 'cello');
      equal(fixture.doc.body.dataset.authorPrintReady, 'false', 'Choosing a different part must immediately invalidate the previous part’s printable pages');
      if (field<HTMLButtonElement>(fixture, '#print-score').disabled) {
        await waitFor(() => !field<HTMLButtonElement>(fixture, '#print-score').disabled, 'Enable printing only after the cello part is composed', fixture.doc);
      }
      click(fixture, '#print-score');
      await waitFor(() => fixture.printRequests === 2, 'Finish the new part projection before requesting print', fixture.doc);
      await settle(fixture);
      const second = fixture.printed[1];
      equal([second.ready, second.renderState, second.part], ['true', 'ready', 'cello'], 'The print boundary must observe the current ready part');
      equal(second.eventIds, scoreEvents(celloScore).map(item => item.id).sort(), 'A cello print request must never reuse full-score pages');
      assert(second.pages > 0 && second.text.includes('Fresh metadata proof') && second.text.includes('Cello'), 'The current title and part label must accompany the selected part notation.');
      pageCoverage(fixture, 'letter', celloScore);
      return 'Both metadata input and part switching revoke print readiness immediately. Intercepted requests see completed pages with the latest title and only the selected part’s events; no PDF file is generated by this check.';
    },
  },
  {
    name: 'A valid score requests print once without claiming a PDF was saved',
    async run() {
      const fixture = await mount('Qualified print request boundary');
      await openPages(fixture);
      equal(events(fixture), [], 'The blank starter must remain unwritten until music is deliberately entered');
      equal(fixture.doc.body.dataset.authorPrintReady, 'false', 'An unwritten voice must block normal publication');
      assert(/empty voice|unwritten/i.test(field(fixture, '#page-preflight').textContent ?? ''), 'Preflight must explain that the blank voice needs written music.');
      const blank = snapshot(fixture), revision = fixture.doc.body.dataset.authorRevision;
      const printButton = field<HTMLButtonElement>(fixture, '#print-score');
      if (!printButton.disabled) {
        click(fixture, '#print-score');
        await waitFor(() => !printButton.disabled && /not ready/i.test(field(fixture, '#author-errors').textContent ?? ''),
          'Reject printing the unwritten starter', fixture.doc);
      }
      equal(fixture.printRequests, 0, 'An empty starter must not issue a print request');
      equal(snapshot(fixture), blank, 'A rejected empty-score print request must not invent music');
      equal(fixture.doc.body.dataset.authorRevision, revision, 'A rejected print request must not create authoring history');
      click(fixture, '#view-write');
      await settle(fixture);
      await insertNote(fixture, 'C4', 'whole');
      await openPages(fixture);
      equal(fixture.doc.body.dataset.authorPrintReady, 'true', 'The deliberately completed whole-note bar must pass normal publication checks');
      equal(field<HTMLInputElement>(fixture, '#print-draft').checked, false, 'The valid print request must not rely on Draft output');
      pageCoverage(fixture, 'letter');
      click(fixture, '#print-score');
      await waitFor(() => fixture.printRequests === 1, 'Request printing of the completed physical pages', fixture.doc);
      await settle(fixture);
      equal(fixture.printRequests, 1, 'One intentional action must issue one print request');
      const status = field(fixture, '#author-status').textContent ?? '';
      assert(/\bprint requested\b/i.test(status), 'The status must identify the action as a print request.');
      assert(/(?:does not|doesn't|cannot|can't)\s+(?:confirm|verify).{0,45}(?:PDF|saved)/i.test(status),
        'The status must explain that a print request does not confirm a saved PDF.');
      equal([fixture.printed[0].ready, fixture.printed[0].renderState], ['true', 'ready'], 'Printing must observe completed, publication-ready pages');
      assert(field(fixture, '#page-host').querySelector('.score-page svg'), 'Prepared vector notation remains available after the print request.');
      return 'Preflight rejects the unwritten starter without a print request or edit. After a whole C4 is written through the visible controls, completed vector pages invoke the fixture’s intercepted print function once. No native dialog, downloaded file, or saved PDF is claimed.';
    },
  },
];

async function run(): Promise<void> {
  runButton.disabled = true;
  // Dispose our documents before removing only their own recovery records.
  // Never clear origin storage: this page may share an origin with real music.
  fixtures.replaceChildren();
  for (const key of ownedRecoveryKeys) localStorage.removeItem(key);
  ownedRecoveryKeys.clear();
  results.replaceChildren();
  sequence = 0;
  runToken = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  metrics = { workspaces: 0, selects: 0, pages: 0, systems: 0, printRequests: 0 };
  summary.dataset.state = 'running';
  environment.textContent = `${navigator.userAgent}; devicePixelRatio ${window.devicePixelRatio}. Actual same-origin author.html fixtures, isolated recovery, bundled fonts, and public notation rendering promises.`;
  const report: Result[] = [];
  for (const [index, test] of tests.entries()) {
    const item = document.createElement('li');
    item.dataset.state = 'running';
    const name = document.createElement('strong');
    name.textContent = `Running: ${test.name}`;
    item.append(name);
    results.append(item);
    summary.textContent = `Running ${index + 1} of ${tests.length}: ${test.name}`;
    try {
      const detail = await test.run();
      item.dataset.state = 'passed';
      name.textContent = `PASS — ${test.name}`;
      const explanation = document.createElement('div');
      explanation.textContent = detail;
      item.append(explanation);
      report.push({ name: test.name, passed: true, detail });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      item.dataset.state = 'failed';
      name.textContent = `FAIL — ${test.name}`;
      const explanation = document.createElement('pre');
      explanation.textContent = detail;
      item.append(explanation);
      report.push({ name: test.name, passed: false, detail });
    }
  }
  const passed = report.filter(result => result.passed).length;
  const failed = report.length - passed;
  summary.dataset.state = failed ? 'failed' : 'passed';
  summary.textContent = `${passed}/${tests.length} Author browser regressions passed${failed ? `; ${failed} failed` : ''}. ${metrics.workspaces} isolated workspaces; ${metrics.selects} native selects; ${metrics.pages} physical pages and ${metrics.systems} complete systems inspected. Fixtures remain below. Actual PDF export still requires separate inspection.`;
  let output = document.querySelector<HTMLScriptElement>('#browser-results');
  if (!output) {
    output = document.createElement('script');
    output.id = 'browser-results';
    output.type = 'application/json';
    document.body.append(output);
  }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, metrics, results: report }, null, 2);
  runButton.disabled = false;
}

runButton.addEventListener('click', () => { void run(); });
