import type { MusicSurface } from '../src/components/index.js';
import type { MusicEvent, Score } from '../src/model/types.js';

interface Fixture {
  frame: HTMLIFrameElement; doc: Document; view: Window; workspace: string;
  confirmationDecision: 'confirm' | 'cancel'; confirmations: { message: string; decision: 'confirm' | 'cancel' }[];
  stopConfirmations?: () => void;
}
interface Snapshot { source: string; revision: number; music: string }
interface Test { name: string; run: () => Promise<string> }
interface Result { name: string; passed: boolean; detail: string }

const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
const visualButtons = [...document.querySelectorAll<HTMLButtonElement>('.visual-controls button')];
const visualFixtures = document.querySelector<HTMLElement>('#visual-fixtures')!;
const visualStatus = document.querySelector<HTMLElement>('#visual-status')!;
const ownedKeys = new Set<string>();
const accidentalButtons = ['#note-double-flat', '#note-flat', '#note-natural', '#note-sharp', '#note-double-sharp'] as const;
let token = '';
let sequence = 0;
let busy = false;
let transactions = 0;
let latestFixture: Fixture | undefined;

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`);
}
function setBusy(value: boolean): void { busy = value; runButton.disabled = value; visualButtons.forEach(button => { button.disabled = value; }); }
async function watchdog<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: did not complete within 20 seconds.`)), 20_000);
  })]); } finally { clearTimeout(timer); }
}
async function frames(fixture: Fixture): Promise<void> {
  await watchdog(new Promise<void>(resolve => fixture.view.requestAnimationFrame(() => fixture.view.requestAnimationFrame(() => resolve()))), 'Observe the actual viewport');
}
async function waitFor(fixture: Fixture, check: () => boolean, label: string): Promise<void> {
  let observer: MutationObserver | undefined; let animation = 0;
  try {
    await watchdog(new Promise<void>((resolve, reject) => {
      const inspect = () => { try { if (check()) resolve(); } catch (error) { reject(error); } };
      const frame = () => { inspect(); animation = fixture.view.requestAnimationFrame(frame); };
      observer = new MutationObserver(inspect);
      observer.observe(fixture.doc.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
      animation = fixture.view.requestAnimationFrame(frame); inspect();
    }), label);
  } finally { observer?.disconnect(); fixture.view.cancelAnimationFrame(animation); }
}
function field<T extends HTMLElement = HTMLElement>(fixture: Fixture, selector: string): T {
  const value = fixture.doc.querySelector<T>(selector); assert(value, `The actual Author route is missing ${selector}.`); return value;
}
function visible(fixture: Fixture, element: Element): boolean {
  const style = fixture.view.getComputedStyle(element);
  return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden';
}

/** Follow the actual public pane/popover controls; never reveal a hidden field by mutation. */
function enterAtSelection(fixture: Fixture): void {
  const enter = field<HTMLElement>(fixture, '#toggle-entry');
  if (enter.getAttribute('aria-pressed') === 'true') return;
  // Resume is a distinct musical destination. Test setup deliberately starts
  // at its current selection even when the remembered entry point differs.
  click(fixture, visible(fixture, enter) ? '#toggle-entry' : '#start-entry-here');
  assert(enter.getAttribute('aria-pressed') === 'true', 'The public Enter-here action must enable entry at the selected location.');
}

function revealControl(fixture: Fixture, selector: string): HTMLElement {
  const target = field<HTMLElement>(fixture, selector);
  if (visible(fixture, target)) return target;
  const inspector = target.closest<HTMLElement>('#selection-inspector, #passage-inspector, #annotation-inspector, #measure-inspector');
  if (inspector) {
    const tabs: Record<string, string> = {
      'selection-inspector': 'edit', 'passage-inspector': 'rhythm',
      'annotation-inspector': 'markings', 'measure-inspector': 'measure',
    };
    if (!visible(fixture, field<HTMLElement>(fixture, '#workspace-tools'))) click(fixture, '#tools-toggle');
    const tab = '#tool-tab-' + tabs[inspector.id];
    if (field<HTMLElement>(fixture, tab).getAttribute('aria-selected') !== 'true') click(fixture, tab);
  }
  const popover = target.closest<HTMLElement>('[popover]');
  if (popover && !popover.matches(':popover-open')) {
    const invokers = [...fixture.doc.querySelectorAll<HTMLButtonElement>(
      '[popovertarget="' + popover.id + '"]:not([popovertargetaction="hide"])')];
    const invoker = invokers.find(button => visible(fixture, button)) ?? invokers[0];
    assert(invoker?.id, popover.id + ' needs a public popover invoker.');
    if (popover.id === 'entry-settings' && !visible(fixture, invoker)) {
      assert(fixture.doc.body.dataset.view === 'write', 'Entry settings must not be exposed outside Write.');
      enterAtSelection(fixture);
    }
    click(fixture, '#' + invoker.id);
  }
  if (!visible(fixture, target) && ['event-kind', 'event-duration', 'insert-event', 'entry-settings-trigger', 'drag-entry'].includes(target.id)) {
    assert(fixture.doc.body.dataset.view === 'write', 'Entry controls must not be exposed outside Write.');
    enterAtSelection(fixture);
  }
  const disclosures: HTMLDetailsElement[] = [];
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
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
  const element = revealControl(fixture, selector); assert(visible(fixture, element), `${selector} must be visible before use.`);
  assert(!('disabled' in element) || !element.disabled, `${selector} is unexpectedly disabled.`);
  element.focus(); element.click();
}
function disclose(fixture: Fixture, selector: string): void {
  const panel = field<HTMLElement>(fixture, selector);
  if (panel.localName === 'details') {
    if (!(panel as HTMLDetailsElement).open) click(fixture, `${selector} > summary`);
    assert((panel as HTMLDetailsElement).open, `${selector} must open through its actual summary.`);
  } else revealControl(fixture, selector);
  assert(visible(fixture, panel), `${selector} must be visible through its public controls.`);
}
function changeEvent(fixture: Fixture, element: HTMLElement, type: string): void {
  const event = fixture.doc.createEvent('Event'); event.initEvent(type, true, false); element.dispatchEvent(event);
}
function write(fixture: Fixture, selector: string, value: string): void {
  const input = revealControl(fixture, selector) as HTMLInputElement | HTMLTextAreaElement;
  assert(visible(fixture, input) && !input.disabled, `${selector} must be available for writing.`);
  input.focus(); input.value = value; changeEvent(fixture, input, 'input'); changeEvent(fixture, input, 'change');
}
function choose(fixture: Fixture, selector: string, value: string): void {
  const select = revealControl(fixture, selector) as HTMLSelectElement;
  assert(visible(fixture, select) && !select.disabled, `${selector} must be available as a native choice.`);
  assert([...select.options].some(option => option.value === value), `${selector} does not offer ${value}.`);
  select.focus(); select.value = value; changeEvent(fixture, select, 'input'); changeEvent(fixture, select, 'change');
}
function source(fixture: Fixture): string { return field<HTMLTextAreaElement>(fixture, '#source-input').value; }
function revision(fixture: Fixture): number { return Number(fixture.doc.body.dataset.authorRevision); }
function surface(fixture: Fixture): MusicSurface {
  const root = field(fixture, '#score-host').shadowRoot?.querySelector<MusicSurface>('music-system, music-staff');
  assert(root && typeof root.renderComplete?.then === 'function', 'The Author route must expose its actual public notation surface.'); return root;
}
function score(fixture: Fixture): Score { const parsed = surface(fixture).score; assert(parsed, 'The accepted notation has no parsed score.'); return parsed; }
function events(fixture: Fixture): MusicEvent[] { return score(fixture).staves.flatMap(staff => staff.measures.flatMap(measure => measure.voices.flatMap(voice => [...voice.events]))); }
function eventById(fixture: Fixture, id: string): MusicEvent { const value = events(fixture).find(event => event.id === id); assert(value, `Missing accepted event ${id}.`); return value; }
function pitch(event: MusicEvent): string {
  const value = event.pitches[0]; assert(value, 'The selected fixture event must be pitched.');
  return `${value.step}${['bb', 'b', '', '#', '##'][value.alter + 2]}${value.octave}`;
}
function music(fixture: Fixture): string {
  const root = surface(fixture);
  return JSON.stringify(score(fixture).staves.map(staff => ({ ...staff, measures: staff.measures.map(measure => ({ ...measure,
    voices: measure.voices.map(voice => ({ ...voice, id: root.getSource(voice.id)?.localName === 'music-voice' ? voice.id : { implicitVoiceOf: measure.id } })),
  })) })));
}
function canonicalSource(fixture: Fixture, html: string): string {
  const template = fixture.doc.createElement('template'); template.innerHTML = html;
  for (const element of template.content.querySelectorAll('*')) {
    const attributes = [...element.attributes].map(attribute => [attribute.name, attribute.value] as const).sort(([a], [b]) => a.localeCompare(b));
    for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
    for (const [name, value] of attributes) element.setAttribute(name, value);
  }
  return template.innerHTML;
}
function snapshot(fixture: Fixture): Snapshot { return { source: source(fixture), revision: revision(fixture), music: music(fixture) }; }
function unchanged(fixture: Fixture, before: Snapshot, label: string): void {
  equal(source(fixture), before.source, `${label}: Source text must remain exact`);
  equal(revision(fixture), before.revision, `${label}: no history revision may be added`);
  equal(music(fixture), before.music, `${label}: accepted musical values and identities must remain unchanged`);
}
function palette(fixture: Fixture): object {
  return Object.fromEntries(['event-kind', 'event-pitch', 'event-pitches', 'event-duration', 'event-dots', 'event-accidental-display', 'event-stem', 'event-beam', 'insert-position']
    .map(id => [id, field<HTMLInputElement | HTMLSelectElement>(fixture, `#${id}`).value]));
}
function configurePalette(fixture: Fixture): object {
  const wasEntering = field(fixture, '#toggle-entry').getAttribute('aria-pressed') === 'true';
  choose(fixture, '#event-kind', 'note'); write(fixture, '#event-pitch', 'D#6');
  choose(fixture, '#event-duration', 'sixteenth'); choose(fixture, '#event-dots', '2'); choose(fixture, '#insert-position', 'before');
  closePanel(fixture, '#entry-settings');
  if (!wasEntering) click(fixture, '#select-mode');
  return palette(fixture);
}
function diagnostic(fixture: Fixture): string {
  try {
    const popover = field(fixture, '#note-editor'); const bounds = popover.getBoundingClientRect();
    return JSON.stringify({ workspace: fixture.workspace, url: fixture.frame.src, viewport: { width: fixture.view.innerWidth, height: fixture.view.innerHeight, scrollY: fixture.view.scrollY },
      state: { ...fixture.doc.body.dataset }, active: fixture.doc.activeElement?.id, popover: { open: popover.matches(':popover-open'), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      context: field(fixture, '#note-editor-context').textContent, feedback: field(fixture, '#note-editor-feedback').textContent,
      localError: { text: field(fixture, '#note-editor-error').textContent, hidden: field(fixture, '#note-editor-error').hidden },
      authorError: field(fixture, '#author-errors').textContent, duration: field<HTMLSelectElement>(fixture, '#note-duration').value,
      confirmations: fixture.confirmations,
      dots: field<HTMLSelectElement>(fixture, '#note-dots').value, palette: palette(fixture),
      accepted: events(fixture).slice(0, 30).map(event => ({ id: event.id, kind: event.kind, pitches: event.pitches, duration: event.duration, dots: event.dots, onset: event.onset, time: event.time })),
    }, null, 2);
  } catch (error) { return `Diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`; }
}
async function settle(fixture: Fixture): Promise<void> {
  await waitFor(fixture, () => fixture.doc.body.dataset.authorReady === 'true' && fixture.doc.body.dataset.renderState !== 'rendering', 'Complete the Author render');
  assert(fixture.doc.body.dataset.renderState === 'ready', `Author failed to render: ${field(fixture, '#author-errors').textContent}`);
  await watchdog(fixture.doc.fonts.ready, 'Load the bundled notation fonts');
  await watchdog(surface(fixture).renderComplete, 'Finish actual notation rendering');
  const errors = surface(fixture).diagnostics.filter(error => error.severity === 'error');
  assert(!errors.length, `Accepted notation must remain valid: ${errors.map(error => error.message).join(' ')}`);
}
async function exposeScore(fixture: Fixture): Promise<void> {
  closePanel(fixture, '#entry-settings');
  closePanel(fixture, '#location-panel');
  const editor = field(fixture, '#score-editor'); editor.scrollIntoView({ block: 'center', behavior: 'instant' }); editor.focus({ preventScroll: true });
  await frames(fixture); await settle(fixture);
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
async function mount(label: string, width = 1180, height = 760, container = fixtures): Promise<Fixture> {
  token ||= crypto.randomUUID();
  const workspace = `test-note-editor-${token}-${++sequence}`; const key = `music-notes.author.recovery.v1:${workspace}`;
  assert(localStorage.getItem(key) === null, 'Note-editor fixtures must not replace an existing recovery key.'); ownedKeys.add(key);
  const article = document.createElement('article'); article.className = 'fixture'; article.dataset.workspace = workspace;
  const heading = document.createElement('h3'); heading.textContent = label;
  const note = document.createElement('p'); note.className = 'fixture-note'; note.textContent = 'Actual Author route in an isolated workspace; native controls, no capture shim or production state hooks. ';
  const viewport = document.createElement('div'); viewport.className = 'viewport';
  const frame = document.createElement('iframe'); frame.title = label; frame.style.width = `${width}px`; frame.style.height = `${height}px`;
  const loaded = new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.src = `/author.html?workspace=${workspace}`;
  const open = document.createElement('a'); open.href = frame.src; open.target = '_blank'; open.rel = 'noopener'; open.textContent = 'Open this isolated workspace';
  note.append(open); viewport.append(frame); article.append(heading, note, viewport); container.append(article);
  await watchdog(loaded, 'Load the actual note-editor workspace');
  assert(frame.contentDocument && frame.contentWindow, 'The fixture must stay on the same origin.');
  const fixture: Fixture = { frame, doc: frame.contentDocument, view: frame.contentWindow, workspace,
    confirmationDecision: 'confirm', confirmations: [] }; latestFixture = fixture;
  observeFixtureConfirmations(fixture);
  fixture.view.print = () => { throw new Error('Note-editor checks must not open native printing.'); };
  await settle(fixture); await exposeScore(fixture); return fixture;
}
function staffSource(rhythm: string, rest = ''): string {
  return `<music-staff id="blank-staff" label="Editor study" clef="treble" key="C" meter="4/4"><music-measure id="blank-m1">${rhythm}</music-measure>${rest}</music-staff>`;
}
const phrase = '<!-- retain this written idea --><music-note id="edit-a" pitch="F4" duration="half" stem="down" beam="none" accidental-display="courtesy" data-author="kept"></music-note><music-direction id="listen" text="Listen before moving on" at="1/2"></music-direction><music-note id="edit-b" pitch="G4" duration="half"></music-note>';
function longSource(): string {
  return staffSource('<music-rest id="long-rest-1" measure></music-rest>', Array.from({ length: 7 }, (_, index) => {
    const number = index + 2;
    const events = number === 7
      ? '<!-- preserve the late entrance --><music-note id="long-note" pitch="F#4" duration="half" data-author="late"></music-note><music-note id="long-next" pitch="A4" duration="half"></music-note>'
      : `<music-rest id="long-rest-${number}" measure></music-rest>`;
    return `<music-measure id="long-bar-${number}"${number % 2 === 1 ? ' break-before="line"' : ''}>${events}</music-measure>`;
  }).join(''));
}
async function applySource(fixture: Fixture, html: string): Promise<void> {
  disclose(fixture, '#source-panel'); write(fixture, '#source-input', html);
  const before = revision(fixture); click(fixture, '#source-apply');
  await waitFor(fixture, () => revision(fixture) > before && fixture.doc.body.dataset.renderState === 'ready', 'Apply valid fixture source');
  await settle(fixture); closePanel(fixture, '#source-panel'); await exposeScore(fixture);
}
async function selectEvent(fixture: Fixture, id: string): Promise<void> {
  const recipe = palette(fixture);
  if (field(fixture, '#toggle-entry').getAttribute('aria-pressed') === 'true') click(fixture, '#select-mode');
  const root = surface(fixture); const layout = root.getLayoutGeometry(); assert(layout, 'Selecting a fixture event requires current public geometry.');
  const system = layout.systems.find(system => system.events.some(event => event.sourceId === id)); assert(system, `No rendered system contains ${id}.`);
  const svg = root.shadowRoot!.querySelectorAll<SVGSVGElement>(`.${layout.projection} .system-row svg`)[system.index];
  const element = [...svg.querySelectorAll<SVGGraphicsElement>('g[data-source-id]')].find(element => element.dataset.sourceId === id);
  assert(element && visible(fixture, element), `The actual engraved event ${id} must be available for selection.`);
  svg.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); await frames(fixture);
  const geometry = system.events.find(event => event.sourceId === id)!; const head = geometry.noteheads?.[0];
  const matrix = svg.getScreenCTM(); assert(matrix, 'The event must have a current screen transform.');
  const point = new DOMPoint(head?.centerX ?? geometry.ink.x + geometry.ink.width / 2, head?.centerY ?? geometry.ink.y + geometry.ink.height / 2).matrixTransform(matrix);
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, view: fixture.view, detail: 1, clientX: point.x, clientY: point.y }));
  await frames(fixture); await settle(fixture);
  equal(palette(fixture), recipe, `Selecting ${id} through its actual engraving must not repurpose any insertion setting`);
}
function editorOpen(fixture: Fixture): boolean { return field(fixture, '#note-editor').matches(':popover-open'); }
async function openEditor(fixture: Fixture): Promise<void> {
  const before = snapshot(fixture);
  if (!visible(fixture, field(fixture, '#edit-selected-event'))
    && field(fixture, '#toggle-entry').getAttribute('aria-pressed') === 'true') click(fixture, '#select-mode');
  const popup = field(fixture, '#note-editor');
  equal(popup.getAttribute('popover'), 'auto', 'The immediate editor must be a native auto popover');
  assert(typeof popup.showPopover === 'function', 'This browser must support the native popover API for these checks.');
  if (!editorOpen(fixture)) click(fixture, '#edit-selected-event');
  await waitFor(fixture, () => editorOpen(fixture) && visible(fixture, popup), 'Open the native note editor');
  await frames(fixture);
  equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'false', 'Opening the note editor must enter Select mode');
  assert(!fixture.doc.body.dataset.pointerGesture, 'Opening the note editor must leave no active staff gesture.');
  unchanged(fixture, before, 'Selecting the editing mode and opening the native note editor');
}
async function closeEditor(fixture: Fixture): Promise<void> {
  if (!editorOpen(fixture)) return;
  click(fixture, '#close-note-editor'); await waitFor(fixture, () => !editorOpen(fixture), 'Close the native note editor');
}
function focusRetained(fixture: Fixture, id: string): void {
  equal(fixture.doc.activeElement?.id, id, 'An immediate edit must retain focus on the control that performed it');
  assert(editorOpen(fixture), 'A local property edit must leave the note editor open.');
  equal(Number(field(fixture, '#note-editor').dataset.revision), revision(fixture), 'The open editor must stay bound to the accepted revision');
}
function identity(fixture: Fixture, id: string): void {
  equal(field(fixture, '#note-editor').dataset.eventId, id, 'The editor must identify the actual selected source event');
  equal(Number(field(fixture, '#note-editor').dataset.revision), revision(fixture), 'The editor must use the accepted source revision');
  assert(/\b(?:bar|measure)\s+\d+\b/i.test(field(fixture, '#note-editor-context').textContent ?? '')
    && /\bvoice\s+\d+\b/i.test(field(fixture, '#note-editor-context').textContent ?? ''), 'The visible context must identify the bar and voice.');
}
async function quickChange(fixture: Fixture, action: () => void, expected: () => boolean, focusId: string): Promise<Snapshot> {
  const before = snapshot(fixture); action();
  await waitFor(fixture, () => revision(fixture) === before.revision + 1 && fixture.doc.body.dataset.renderState === 'ready' && expected(), 'Commit one immediate property edit');
  await settle(fixture); await frames(fixture); focusRetained(fixture, focusId);
  assert(field(fixture, '#note-editor-error').hidden, 'A successful edit must clear local errors.'); transactions++; return before;
}
async function undoQuick(fixture: Fixture, before: Snapshot): Promise<void> {
  const previous = revision(fixture); click(fixture, '#note-editor-undo');
  await waitFor(fixture, () => revision(fixture) > previous && fixture.doc.body.dataset.renderState === 'ready'
    && canonicalSource(fixture, source(fixture)) === canonicalSource(fixture, before.source), 'Undo one immediate note-editor change');
  await settle(fixture); await frames(fixture); equal(music(fixture), before.music, 'One Undo must restore the exact musical state');
  if (!field<HTMLButtonElement>(fixture, '#note-editor-undo').disabled) focusRetained(fixture, 'note-editor-undo');
  else {
    const active = fixture.doc.activeElement;
    assert(editorOpen(fixture) && active && field(fixture, '#note-editor').contains(active)
      && active.matches('button, select, input') && !active.matches(':disabled') && visible(fixture, active),
    'After its final local Undo, focus must move from the disabled Undo button to an enabled visible control inside the editor.');
    equal(Number(field(fixture, '#note-editor').dataset.revision), revision(fixture), 'The editor must retain its accepted binding after the final Undo');
  }
}
function sourceAttributes(fixture: Fixture, id: string, omit: readonly string[] = []): object {
  const template = fixture.doc.createElement('template'); template.innerHTML = source(fixture);
  const element = template.content.querySelector(`#${CSS.escape(id)}`); assert(element, `Source does not contain ${id}.`);
  return Object.fromEntries([...element.attributes].filter(attribute => !omit.includes(attribute.name)).map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b)));
}
function assertPopupBounds(fixture: Fixture): void {
  const popup = field(fixture, '#note-editor'); const rect = popup.getBoundingClientRect();
  assert(rect.width > 0 && rect.height > 0 && rect.left >= -0.5 && rect.top >= -0.5
    && rect.right <= fixture.view.innerWidth + 0.5 && rect.bottom <= fixture.view.innerHeight + 0.5,
  `The native editor must fit ${fixture.view.innerWidth}×${fixture.view.innerHeight}; actual ${JSON.stringify({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })}.`);
  assert(fixture.doc.documentElement.scrollWidth <= fixture.view.innerWidth + 1, 'The editor must not create horizontal document overflow.');
}
function assertInEditorBody(fixture: Fixture, selector: string, label: string): void {
  const element = field(fixture, selector); const rect = element.getBoundingClientRect();
  const body = field(fixture, '.note-editor-body'); const bodyRect = body.getBoundingClientRect();
  const footerTop = field(fixture, '.note-editor-footer').getBoundingClientRect().top;
  const bounds = { left: bodyRect.left + body.clientLeft, top: bodyRect.top + body.clientTop,
    right: Math.min(fixture.view.innerWidth, bodyRect.left + body.clientLeft + body.clientWidth),
    bottom: Math.min(fixture.view.innerHeight, footerTop, bodyRect.top + body.clientTop + body.clientHeight) };
  assert(visible(fixture, element) && rect.width > 0 && rect.height > 0
    && rect.left >= bounds.left - 0.5 && rect.right <= bounds.right + 0.5
    && rect.top >= bounds.top - 0.5 && rect.bottom <= bounds.bottom + 0.5,
  `${label}: ${selector} must be fully visible inside the editor body and above its footer without harness scrolling.\n${JSON.stringify({
    control: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, body: bounds,
    footerTop, bodyScrollTop: body.scrollTop, bodyClientHeight: body.clientHeight, bodyScrollHeight: body.scrollHeight,
  })}`);
}
function assertCoreControlsVisible(fixture: Fixture, label: string): void {
  for (const selector of ['#note-duration', '#note-dots']) assertInEditorBody(fixture, selector, label);
}

const tests: Test[] = [
  {
    name: 'The native editor is obvious beside the score and keeps insertion settings independent',
    async run() {
      const fixture = await mount('A selected note has an explicit editor');
      assert(field<HTMLButtonElement>(fixture, '#edit-selected-event').disabled, 'A measure-only selection must not offer an individual event edit.');
      await applySource(fixture, staffSource(phrase)); await selectEvent(fixture, 'edit-a');
      const wantedPalette = configurePalette(fixture); click(fixture, '#toggle-entry'); await frames(fixture);
      equal(field(fixture, '#toggle-entry').getAttribute('aria-pressed'), 'true', 'The fixture must begin with entry enabled before opening note editing');
      const before = snapshot(fixture); const bounds = field(fixture, '#score-host').getBoundingClientRect();
      const trigger = field(fixture, '#edit-selected-event');
      equal(trigger.getAttribute('popovertarget'), 'note-editor', 'The sticky action must invoke the native note editor');
      equal(field(fixture, '#close-note-editor').getAttribute('popovertargetaction'), 'hide', 'Close must be a native hide invoker');
      await openEditor(fixture); identity(fixture, 'edit-a');
      const afterBounds = field(fixture, '#score-host').getBoundingClientRect();
      for (const property of ['x', 'y', 'width', 'height'] as const) assert(Math.abs(bounds[property] - afterBounds[property]) < 1,
        'Opening a native overlay must not reflow the written score.');
      equal(palette(fixture), wantedPalette, 'Opening note editing must preserve the configured insertion fields');
      for (const [selector, text] of [['#note-flat', 'Flat'], ['#note-natural', 'Natural'], ['#note-sharp', 'Sharp']] as const) {
        assert(visible(fixture, field(fixture, selector)) && field(fixture, selector).textContent?.includes(text), `${text} must be an obvious named action, not only an unexplained sign.`);
      }
      equal([field<HTMLSelectElement>(fixture, '#note-duration').value, field<HTMLSelectElement>(fixture, '#note-dots').value], ['half', '0'], 'The popup must display the accepted note rather than the insertion fields');
      assert(!field(fixture, '#note-editor').querySelector('#update-event, #source-apply, button[type="submit"]'), 'Common property changes must not require a staged Apply action.');
      unchanged(fixture, before, 'Opening the immediate editor');
      await closeEditor(fixture); await frames(fixture);
      equal(fixture.doc.activeElement?.id, 'edit-selected-event', 'Native Close must return focus to its invoker');
      equal(palette(fixture), wantedPalette, 'Closing note editing must preserve insertion settings'); unchanged(fixture, before, 'Closing the immediate editor');
      return 'The sticky Edit note action opens a native popover with named Flat/Natural/Sharp controls and accepted half-note values. It enters Select without reflowing the score or changing configured D#6 insertion settings; native Close returns focus.';
    },
  },
  {
    name: 'All five accidental choices are absolute, preserve source details, and undo individually',
    async run() {
      const fixture = await mount('Spell the selected note without rewriting its rhythm');
      await applySource(fixture, staffSource(phrase).replace('key="C"', 'key="G"')); await selectEvent(fixture, 'edit-a');
      const wantedPalette = configurePalette(fixture); const preserved = sourceAttributes(fixture, 'edit-a', ['pitch', 'accidental']);
      const original = eventById(fixture, 'edit-a'); const { pitches: _pitches, ...rhythm } = original;
      const nextEvent = JSON.stringify(eventById(fixture, 'edit-b')); const changes: Snapshot[] = [];
      await openEditor(fixture);
      for (const [selector, alter, spelling] of [['#note-sharp', 1, 'F#4'], ['#note-flat', -1, 'Fb4'], ['#note-natural', 0, 'F4'], ['#note-double-flat', -2, 'Fbb4'], ['#note-double-sharp', 2, 'F##4']] as const) {
        changes.push(await quickChange(fixture, () => click(fixture, selector), () => eventById(fixture, 'edit-a').pitches[0].alter === alter, selector.slice(1)));
        const changed = eventById(fixture, 'edit-a'); const { pitches: _changed, ...unchangedRhythm } = changed;
        equal([pitch(changed), changed.pitches[0].step, changed.pitches[0].octave, changed.pitches[0].display], [spelling, 'F', 4, 'courtesy'], 'Accidental choices must preserve the written letter, octave, and display policy');
        equal(unchangedRhythm, rhythm, 'An accidental edit must preserve every non-pitch event property');
        equal(sourceAttributes(fixture, 'edit-a', ['pitch', 'accidental']), preserved, 'Accidental edits must preserve unrelated source attributes');
        equal(JSON.stringify(eventById(fixture, 'edit-b')), nextEvent, 'Accidental editing must not affect the next event');
        assert(source(fixture).includes('<!-- retain this written idea -->'), 'The source comment must survive each narrow edit.');
        equal(field(fixture, selector).getAttribute('aria-pressed'), 'true', 'The accepted accidental must be visibly selected');
        equal(accidentalButtons.filter(button => field(fixture, button).getAttribute('aria-pressed') === 'true').length, 1, 'Exactly one accidental must be selected for a single note');
        identity(fixture, 'edit-a'); equal(palette(fixture), wantedPalette, 'Accidental editing must not overwrite insertion fields');
        const noOp = snapshot(fixture); click(fixture, selector); await frames(fixture); await settle(fixture);
        unchanged(fixture, noOp, 'Choosing the accepted accidental again'); focusRetained(fixture, selector.slice(1));
      }
      for (const before of changes.reverse()) { await undoQuick(fixture, before); equal(palette(fixture), wantedPalette, 'Local Undo must preserve the insertion palette'); }
      return 'Sharp, Flat, Natural, Double flat, and Double sharp set F#4/Fb4/F4/Fbb4/F##4 even in G major. Rhythm, courtesy display, IDs, annotations, metadata, comments, the following note, and insertion settings survive; repeated choices add no history and each accepted choice undoes once.';
    },
  },
  {
    name: 'Note value and dots change exact rhythm immediately without rewriting pitch or notation settings',
    async run() {
      const fixture = await mount('Immediate duration and dot edits');
      await applySource(fixture, staffSource(phrase)); await selectEvent(fixture, 'edit-a'); const wantedPalette = configurePalette(fixture);
      const attributes = sourceAttributes(fixture, 'edit-a', ['duration', 'dots', 'dotted']); const beforePitch = eventById(fixture, 'edit-a').pitches;
      await openEditor(fixture);
      const duration = await quickChange(fixture, () => choose(fixture, '#note-duration', 'quarter'), () => eventById(fixture, 'edit-a').duration === 'quarter', 'note-duration');
      equal([eventById(fixture, 'edit-a').time, eventById(fixture, 'edit-b').onset], [{ numerator: 1, denominator: 4 }, { numerator: 1, denominator: 4 }], 'Changing the written value must move the following event by exact musical time');
      const dotted = await quickChange(fixture, () => choose(fixture, '#note-dots', '1'), () => eventById(fixture, 'edit-a').dots === 1, 'note-dots');
      equal([eventById(fixture, 'edit-a').time, eventById(fixture, 'edit-b').onset], [{ numerator: 3, denominator: 8 }, { numerator: 3, denominator: 8 }], 'A dot must create an exact dotted quarter and move the next onset');
      equal(eventById(fixture, 'edit-a').pitches, beforePitch, 'Written rhythm editing must preserve spelled pitches');
      equal(sourceAttributes(fixture, 'edit-a', ['duration', 'dots', 'dotted']), attributes, 'Duration and dots must preserve all other source attributes');
      equal(palette(fixture), wantedPalette, 'Duration and dot changes must not populate insertion fields');
      const noOp = snapshot(fixture); choose(fixture, '#note-duration', 'quarter'); choose(fixture, '#note-dots', '1'); await frames(fixture); await settle(fixture);
      unchanged(fixture, noOp, 'Repeated accepted rhythm choices');
      await undoQuick(fixture, dotted); await undoQuick(fixture, duration);
      return 'Half→quarter→dotted quarter produces exact 1/4 and 3/8 times and following onsets. Pitch spelling, stem, beam, courtesy display, source metadata, and the insertion palette remain intact; repeated values add no history and each change has one Undo.';
    },
  },
  {
    name: 'Tuplet rhythm editing preserves ratios and source membership while recomputing exact time',
    async run() {
      const fixture = await mount('Change one written value inside a triplet');
      await applySource(fixture, staffSource('<music-tuplet id="edit-triplet" actual="3" normal="2" bracket="yes"><music-note id="triplet-a" pitch="C5" duration="eighth"></music-note><music-note id="triplet-b" pitch="D5" duration="eighth" data-author="inside"></music-note><music-note id="triplet-c" pitch="E5" duration="eighth"></music-note></music-tuplet><music-rest id="triplet-tail" duration="half" dots="1"></music-rest>'));
      await selectEvent(fixture, 'triplet-b'); const tuplets = JSON.stringify(score(fixture).staves[0].measures[0].voices[0].tuplets); const order = events(fixture).map(event => event.id);
      await openEditor(fixture);
      const change = await quickChange(fixture, () => choose(fixture, '#note-duration', 'sixteenth'), () => eventById(fixture, 'triplet-b').duration === 'sixteenth', 'note-duration');
      equal([eventById(fixture, 'triplet-b').time, eventById(fixture, 'triplet-b').onset, eventById(fixture, 'triplet-c').onset],
        [{ numerator: 1, denominator: 24 }, { numerator: 1, denominator: 12 }, { numerator: 1, denominator: 8 }], 'The triplet ratio must apply exactly to the new written value');
      equal(JSON.stringify(score(fixture).staves[0].measures[0].voices[0].tuplets), tuplets, 'Tuplet ratios, IDs, membership, brackets, and display must remain unchanged');
      equal(events(fixture).map(event => event.id), order, 'The edit must not reorder tuplet members or the following rest');
      equal(eventById(fixture, 'triplet-b').tupletIds, ['edit-triplet'], 'The edited event must stay inside its authored tuplet');
      assert(source(fixture).includes('data-author="inside"'), 'Tuplet member metadata must be preserved.');
      await undoQuick(fixture, change);
      return 'A triplet eighth becomes an exact 1/24 sixteenth while retaining its onset, 3:2 group, source IDs, bracket, metadata, and event order. The following onset is exactly 1/8; one Undo restores the original group.';
    },
  },
  {
    name: 'Overflow rolls back atomically, resets the native choices, and reports the error locally',
    async run() {
      const fixture = await mount('Reject an overfull written rhythm without losing the editor');
      await applySource(fixture, staffSource(phrase)); await selectEvent(fixture, 'edit-a'); await openEditor(fixture);
      const before = snapshot(fixture);
      choose(fixture, '#note-duration', 'whole');
      await waitFor(fixture, () => !field(fixture, '#note-editor-error').hidden && /Voice contains.*meter allows/i.test(field(fixture, '#note-editor-error').textContent ?? ''), 'Report the rejected whole note in the local editor');
      await frames(fixture); await settle(fixture); unchanged(fixture, before, 'Rejected overfull duration');
      equal(field<HTMLSelectElement>(fixture, '#note-duration').value, 'half', 'A rejected duration must reset to the accepted value'); focusRetained(fixture, 'note-duration');
      choose(fixture, '#note-dots', '1');
      await waitFor(fixture, () => !field(fixture, '#note-editor-error').hidden, 'Report the rejected dot'); await frames(fixture);
      unchanged(fixture, before, 'Rejected overfull dot'); equal(field<HTMLSelectElement>(fixture, '#note-dots').value, '0', 'Rejected dots must reset to the accepted count'); focusRetained(fixture, 'note-dots');
      assert(field(fixture, '#author-errors').hidden, 'A handled note-editor validation error must stay local to the note editor.');
      const valid = await quickChange(fixture, () => choose(fixture, '#note-duration', 'quarter'), () => eventById(fixture, 'edit-a').duration === 'quarter', 'note-duration');
      await undoQuick(fixture, valid); equal(canonicalSource(fixture, source(fixture)), canonicalSource(fixture, before.source), 'The first valid edit must be the only Undo step after rejected changes');
      return 'A whole value and a dot that overfill the bar are rejected with a local error, exact Source/history preservation, accepted select values restored, and focus retained. A subsequent valid quarter clears the error and undoes in one step.';
    },
  },
  {
    name: 'Voice navigation shows the accepted event and does not reuse stale writing values',
    async run() {
      const fixture = await mount('Edit the selected voice, not the insertion palette');
      await applySource(fixture, staffSource('<music-voice id="edit-upper"><music-note id="upper-note" pitch="C5" duration="whole"></music-note></music-voice><music-voice id="edit-lower"><music-note id="lower-note" pitch="G3" duration="whole"></music-note></music-voice>'));
      await selectEvent(fixture, 'upper-note'); const wantedPalette = configurePalette(fixture);
      choose(fixture, '#event-voice', '1'); await frames(fixture); await settle(fixture);
      equal(palette(fixture), wantedPalette, 'Voice navigation without population must retain the existing writing palette');
      disclose(fixture, '#selection-inspector');
      equal([field<HTMLInputElement>(fixture, '#selected-pitch').value, field<HTMLSelectElement>(fixture, '#selected-duration').value],
        ['G3', 'whole'], 'Pristine Advanced Edit must bind to the selected lower voice instead of reusing the upper voice or insertion recipe');
      assert(!visible(fixture, field(fixture, '#load-event-values')), 'A clean selection must not require a routine Load action.');
      await openEditor(fixture); identity(fixture, 'lower-note');
      assert(/G3/.test(field(fixture, '#note-editor-heading').textContent ?? '') && /voice\s+2/i.test(field(fixture, '#note-editor-context').textContent ?? ''), 'The popup must name the lower voice’s accepted G3.');
      equal(field<HTMLSelectElement>(fixture, '#note-duration').value, 'whole', 'The popup must ignore the stale sixteenth-note insertion value');
      const upper = JSON.stringify(eventById(fixture, 'upper-note'));
      const change = await quickChange(fixture, () => click(fixture, '#note-flat'), () => pitch(eventById(fixture, 'lower-note')) === 'Gb3', 'note-flat');
      equal(JSON.stringify(eventById(fixture, 'upper-note')), upper, 'The unselected voice must remain exact'); equal(palette(fixture), wantedPalette, 'Quick editing voice 2 must retain insertion settings');
      await undoQuick(fixture, change);
      return 'Voice navigation preserves the insertion recipe while pristine Advanced Edit follows the selected lower voice. Edit note opens G3 whole, changes only it to Gb3, preserves voice 1 and all entry settings, and undoes once.';
    },
  },
  {
    name: 'A conflicting quick edit preserves the advanced draft until explicit discard and reload',
    async run() {
      const fixture = await mount('Dirty Advanced Edit stays attached to its accepted source event');
      await applySource(fixture, staffSource(phrase)); await selectEvent(fixture, 'edit-a');
      const intendedPalette = configurePalette(fixture); disclose(fixture, '#selection-inspector');
      assert(!visible(fixture, field(fixture, '#load-event-values')), 'A pristine editor must bind without requiring Load.');
      write(fixture, '#selected-pitch', 'B5'); choose(fixture, '#selected-duration', 'quarter');
      assert(!field<HTMLButtonElement>(fixture, '#update-event').disabled, 'A valid dirty selection should enable its bound Apply.');
      await openEditor(fixture); await quickChange(fixture, () => click(fixture, '#note-sharp'), () => pitch(eventById(fixture, 'edit-a')) === 'F#4', 'note-sharp');
      equal(palette(fixture), intendedPalette, 'Quick editing must not silently overwrite the unapplied writing values');
      await closeEditor(fixture);
      assert(field<HTMLButtonElement>(fixture, '#update-event').disabled, 'Changing an edited target property must invalidate the conflicting Advanced Apply binding.');
      equal([field<HTMLInputElement>(fixture, '#selected-pitch').value, field<HTMLSelectElement>(fixture, '#selected-duration').value],
        ['B5', 'quarter'], 'The conflicting advanced draft must remain available, separately from the insertion recipe');
      const guarded = snapshot(fixture);
      field<HTMLButtonElement>(fixture, '#update-event').dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
      await frames(fixture);
      unchanged(fixture, guarded, 'Attempting stale Advanced Apply');
      click(fixture, '#load-event-values');
      equal([field<HTMLInputElement>(fixture, '#selected-pitch').value, field<HTMLSelectElement>(fixture, '#selected-duration').value], ['F#4', 'half'], 'Explicit discard and reload must read the fresh accepted note');
      equal(palette(fixture), intendedPalette, 'Resolving an advanced conflict must not copy note values into the entry recipe');
      write(fixture, '#selected-pitch', 'A4'); const other = JSON.stringify(eventById(fixture, 'edit-b')); const beforeApply = revision(fixture);
      click(fixture, '#update-event');
      await waitFor(fixture, () => revision(fixture) === beforeApply + 1 && fixture.doc.body.dataset.renderState === 'ready' && pitch(eventById(fixture, 'edit-a')) === 'A4', 'Apply freshly loaded advanced values');
      equal(JSON.stringify(eventById(fixture, 'edit-b')), other, 'Fresh Advanced Apply must affect only the bound event');
      equal(eventById(fixture, 'edit-a').duration, 'half', 'Applying only the new pitch must retain the accepted duration after discarding the conflicting draft');
      equal(palette(fixture), intendedPalette, 'Fresh Advanced Apply must leave the next-entry recipe unchanged');
      return 'A quick accidental change preserves both the independent entry recipe and a conflicting B5/quarter advanced draft. Stale Apply does nothing; explicit discard/reload reads F#4/half, and the next pitch-only Apply changes only the bound event.';
    },
  },
  {
    name: 'Chords, rests, slashes, and ties expose accurate support instead of misleading pitch controls',
    async run() {
      const fixture = await mount('Accurate support for every event kind');
      await applySource(fixture, staffSource('<music-chord id="kind-chord" pitches="C4 E4 G4" duration="whole"></music-chord>',
        '<music-measure id="kind-rest-bar"><music-rest id="kind-rest" duration="whole"></music-rest></music-measure>'
        + '<music-measure id="kind-rhythmic-bar"><music-slash id="kind-rhythmic" duration="whole" rhythmic></music-slash></music-measure>'
        + '<music-measure id="kind-open-bar"><music-slash id="kind-open" duration="whole"></music-slash></music-measure>'
        + '<music-measure id="kind-measure-rest-bar"><music-rest id="kind-measure-rest" measure></music-rest></music-measure>'
        + '<music-measure id="kind-tied-bar"><music-note id="kind-tie-start" pitch="C4" duration="half" tie="start"></music-note><music-note id="kind-tie-end" pitch="C4" duration="half" tie="end"></music-note></music-measure>'));
      for (const id of ['kind-chord', 'kind-rest', 'kind-rhythmic', 'kind-open', 'kind-measure-rest', 'kind-tie-start']) {
        await selectEvent(fixture, id); await openEditor(fixture); identity(fixture, id);
        assert(accidentalButtons.every(selector => field<HTMLButtonElement>(fixture, selector).disabled), `${id}: unsupported single-note accidental choices must be disabled.`);
        assert(/chord|rest|slash|tied|tie|pitch|inspector/i.test(field(fixture, '#note-accidental-help').textContent ?? ''), `${id}: the accidental limitation must be explained.`);
        if (id === 'kind-open' || id === 'kind-measure-rest') {
          assert(field<HTMLSelectElement>(fixture, '#note-duration').disabled && field<HTMLSelectElement>(fixture, '#note-dots').disabled,
            `${id}: nominal/open or meter-defined duration must not pretend to be an ordinary written value.`);
          assert(/open|measure|meter|rhythmic|replace|inspector/i.test(field(fixture, '#note-rhythm-help').textContent ?? ''), `${id}: the rhythm limitation must be explained.`);
          const before = snapshot(fixture); field<HTMLButtonElement>(fixture, '#note-sharp').click(); await frames(fixture); unchanged(fixture, before, 'Disabled unsupported pitch choice');
        } else {
          const previous = eventById(fixture, id); const duration = previous.duration === 'whole' ? 'half' : 'quarter';
          const change = await quickChange(fixture, () => choose(fixture, '#note-duration', duration), () => eventById(fixture, id).duration === duration, 'note-duration');
          equal([eventById(fixture, id).kind, eventById(fixture, id).pitches, eventById(fixture, id).tie, eventById(fixture, id).rhythmic],
            [previous.kind, previous.pitches, previous.tie, previous.rhythmic], `${id}: written rhythm editing must preserve the event’s musical kind and pitch/tie meaning`);
          await undoQuick(fixture, change);
        }
        await closeEditor(fixture);
      }
      return 'Chords, ordinary rests, rhythmic slashes, and tied notes can change written duration without changing their kind, pitch content, or ties. Accidental choices are disabled with explanations; full-measure rests and open slashes remain openable but correctly disable ordinary duration controls.';
    },
  },
  {
    name: 'A passage selection cannot masquerade as a single editable note',
    async run() {
      const fixture = await mount('Single-note editing and passage selection stay distinct');
      await applySource(fixture, staffSource(phrase)); await selectEvent(fixture, 'edit-a');
      disclose(fixture, '#passage-inspector'); choose(fixture, '#range-start', 'edit-a'); choose(fixture, '#range-end', 'edit-b'); await frames(fixture);
      assert(field<HTMLButtonElement>(fixture, '#edit-selected-event').disabled, 'A multi-event range must disable individual note editing.');
      const before = snapshot(fixture); field<HTMLButtonElement>(fixture, '#edit-selected-event').click(); await frames(fixture);
      assert(!editorOpen(fixture), 'A range must not open an editor pretending to bind just one member.'); unchanged(fixture, before, 'Opening note editing for a range');
      choose(fixture, '#range-start', ''); choose(fixture, '#range-end', ''); await selectEvent(fixture, 'edit-b');
      disclose(fixture, '#selection-inspector');
      equal(field<HTMLInputElement>(fixture, '#selected-pitch').value, 'G4', 'The clean advanced editor must bind to the selected second event.');
      write(fixture, '#selected-pitch', 'B4');
      assert(!field<HTMLButtonElement>(fixture, '#update-event').disabled, 'The fixture must first stage a bound advanced edit for the selected second event.');
      choose(fixture, '#range-start', 'edit-a'); choose(fixture, '#range-end', 'edit-a'); await frames(fixture);
      for (const selector of ['#edit-selected-event', '#update-event']) {
        assert(field<HTMLButtonElement>(fixture, selector).disabled, `${selector} must reject a one-event range whose identity differs from the current cursor.`);
      }
      const reload = field<HTMLButtonElement>(fixture, '#load-event-values');
      assert(reload.disabled || !visible(fixture, reload), 'A mismatched range must not offer a usable discard/rebind action for a different selected event.');
      const mismatched = snapshot(fixture);
      for (const selector of ['#load-event-values', '#update-event']) field(fixture, selector).dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true }));
      await frames(fixture); unchanged(fixture, mismatched, 'A single-event range that does not match the selected event');
      equal(field<HTMLInputElement>(fixture, '#selected-pitch').value, 'B4', 'Rejected mismatched actions must preserve the pending draft at its original event');
      choose(fixture, '#range-start', ''); choose(fixture, '#range-end', ''); await selectEvent(fixture, 'edit-b'); await openEditor(fixture); identity(fixture, 'edit-b');
      return 'A multi-note passage disables Edit note. A one-event A→A range also prevents Edit/Apply or an accidental rebind when the cursor and advanced draft belong to B; stale actions change neither event nor the draft. Clearing the range restores the correctly bound editor.';
    },
  },
  {
    name: 'Stale selection, source drafts, and read-only modes cannot apply an old popup action',
    async run() {
      const fixture = await mount('Invalidate immediate editing when its accepted context changes');
      await applySource(fixture, staffSource(phrase)); await selectEvent(fixture, 'edit-a'); await openEditor(fixture);
      const staleSharp = field<HTMLButtonElement>(fixture, '#note-sharp');
      await selectEvent(fixture, 'edit-b'); await frames(fixture);
      assert(!editorOpen(fixture) || staleSharp.disabled, 'External selection must close or invalidate the previous note editor.');
      const selected = snapshot(fixture); staleSharp.click(); await frames(fixture); await settle(fixture);
      unchanged(fixture, selected, 'Delivering an old popup action after selecting another event');
      await openEditor(fixture);
      await applySource(fixture, staffSource(phrase.replace('pitch="G4"', 'pitch="A4"')));
      assert(!editorOpen(fixture), 'An external accepted Source revision must close the old editor.');
      const revised = snapshot(fixture); staleSharp.click(); await frames(fixture); unchanged(fixture, revised, 'A stale action after an external source revision');
      await selectEvent(fixture, 'edit-b');
      await openEditor(fixture); identity(fixture, 'edit-b');
      disclose(fixture, '#source-panel'); const draft = '<music-staff>unfinished note-editor draft'; write(fixture, '#source-input', draft); await frames(fixture);
      assert(!editorOpen(fixture) || field<HTMLButtonElement>(fixture, '#note-sharp').disabled, 'A pending Source draft must close or invalidate the editor.');
      const pending = snapshot(fixture); field<HTMLButtonElement>(fixture, '#note-sharp').click(); await frames(fixture); unchanged(fixture, pending, 'A popup action while Source is pending');
      equal(source(fixture), draft, 'The pending Source buffer must remain recoverable'); click(fixture, '#source-revert'); await frames(fixture); closePanel(fixture, '#source-panel');
      for (const mode of ['read', 'pages'] as const) {
        if (fixture.doc.body.dataset.view !== 'write') { click(fixture, '#view-write'); await settle(fixture); }
        await selectEvent(fixture, 'edit-a'); await openEditor(fixture);
        click(fixture, `#view-${mode}`); await settle(fixture); await frames(fixture);
        assert(!editorOpen(fixture), `${mode}: the immediate editing overlay must close.`);
        const before = snapshot(fixture); field<HTMLButtonElement>(fixture, '#note-sharp').click(); await frames(fixture);
        unchanged(fixture, before, `${mode}: stale hidden popup action`);
      }
      return 'Changing the selected event, staging Source, or leaving Write invalidates the editor. Deliberately delivered stale button actions add no source/history changes, and the invalid draft remains available until explicitly reverted.';
    },
  },
  {
    name: 'Local Undo shortcuts cannot consume unrelated composition history',
    async run() {
      const fixture = await mount('Bound local undo and keyboard routing');
      await applySource(fixture, staffSource(phrase)); await selectEvent(fixture, 'edit-a'); await openEditor(fixture);
      const initial = snapshot(fixture); const keyboard = field(fixture, '#note-sharp'); keyboard.focus();
      for (const modifiers of [{ metaKey: true }, { ctrlKey: true }]) keyboard.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true, composed: true, cancelable: true, ...modifiers }));
      await frames(fixture); unchanged(fixture, initial, 'Undo shortcuts before any local change');
      assert(field<HTMLButtonElement>(fixture, '#note-editor-undo').disabled, 'Undo change must not offer unrelated history before a local edit.');
      const before = await quickChange(fixture, () => click(fixture, '#note-sharp'), () => pitch(eventById(fixture, 'edit-a')) === 'F#4', 'note-sharp');
      const changedRevision = revision(fixture); keyboard.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true, cancelable: true }));
      await waitFor(fixture, () => revision(fixture) === changedRevision + 1 && fixture.doc.body.dataset.renderState === 'ready'
        && canonicalSource(fixture, source(fixture)) === canonicalSource(fixture, before.source), 'Undo the one local edit through the popup keyboard handler');
      await settle(fixture); assert(editorOpen(fixture), 'A local Undo shortcut must leave the editor open.');
      assert(field(fixture, '#note-editor').contains(fixture.doc.activeElement), 'Local Undo must retain focus inside the editor.');
      const restored = snapshot(fixture); keyboard.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true, cancelable: true })); await frames(fixture);
      unchanged(fixture, restored, 'Another local Undo with an empty local history');
      return 'Synthetic Command/Control+Z exercises only the popup’s application handler: it cannot undo the prior Source load, reverses one local accidental change, then stops. The native browser’s trusted keyboard behavior is not claimed by this check.';
    },
  },
  {
    name: 'Editing a later system keeps its source identity, location, and surrounding music intact',
    async run() {
      const fixture = await mount('Edit a late entrance in a long score', 1180, 660);
      await applySource(fixture, longSource()); choose(fixture, '#measure-select', 'long-bar-7'); await frames(fixture); await settle(fixture);
      await selectEvent(fixture, 'long-note');
      assert((surface(fixture).getLayoutGeometry()?.systems.length ?? 0) >= 4 && field(fixture, '#score-scroll').scrollTop > 0,
        'The fixture must use a genuinely later system in a scrolled, wrapped score.');
      const otherEvents = JSON.stringify(events(fixture).filter(event => event.id !== 'long-note'));
      await openEditor(fixture); identity(fixture, 'long-note'); assertPopupBounds(fixture);
      assert(/measure\s+7/i.test(field(fixture, '#note-editor-context').textContent ?? ''), 'The visible editor must identify measure 7.');
      const change = await quickChange(fixture, () => click(fixture, '#note-flat'), () => pitch(eventById(fixture, 'long-note')) === 'Fb4', 'note-flat');
      equal(JSON.stringify(events(fixture).filter(event => event.id !== 'long-note')), otherEvents, 'Editing a later system must leave all surrounding events unchanged');
      equal(field<HTMLSelectElement>(fixture, '#measure-select').value, 'long-bar-7', 'The selected measure must not jump back to an earlier system');
      assert(source(fixture).includes('<!-- preserve the late entrance -->') && source(fixture).includes('data-author="late"'), 'Late-source metadata and comments must survive the edit.');
      identity(fixture, 'long-note'); assertPopupBounds(fixture); await undoQuick(fixture, change);
      return 'The actual measure selector and engraved note open an editor bound to measure 7 in a wrapped score. F#4→Fb4 changes only that source event, retains the selected measure and popup, preserves surrounding music/comments, and undoes once.';
    },
  },
  {
    name: 'Native customizable choices and popover bounds work on desktop, phone, and short viewports',
    async run() {
      for (const [width, height] of [[1180, 760], [390, 760], [1180, 360], [390, 360]]) {
        const fixture = await mount(`Native note editor at ${width} × ${height}`, width, height);
        await applySource(fixture, staffSource('<music-note id="viewport-note" pitch="C4" duration="whole"></music-note>')); await selectEvent(fixture, 'viewport-note'); await openEditor(fixture); assertPopupBounds(fixture);
        const shortPhone = width === 390 && height === 360;
        if (shortPhone) assertCoreControlsVisible(fixture, 'Initial short-phone opening');
        const popup = field(fixture, '#note-editor');
        equal(popup.getAttribute('aria-labelledby'), 'note-editor-heading', 'The native popover must have its visible heading as an accessible name');
        for (const id of ['note-duration', 'note-dots']) {
          const select = field<HTMLSelectElement>(fixture, `#${id}`); const first = select.firstElementChild;
          assert(first?.localName === 'button' && first.getAttribute('type') === 'button' && first.querySelector('selectedcontent'), `${id} must use the required native customizable-select button and selectedcontent structure.`);
          assert([...select.options].every(option => option.hasAttribute('value')), `${id} choices must retain explicit native values.`);
          assert(select.labels?.length, `${id} must keep an associated visible label.`);
          const enhanced = CSS.supports('appearance', 'base-select') && CSS.supports('selector(::picker(select))');
          if (enhanced) equal(fixture.view.getComputedStyle(select).appearance, 'base-select', `${id} must use the supported native base-select appearance`);
          else assert(fixture.view.getComputedStyle(select).appearance !== 'none', 'An unsupported browser must retain its native select fallback.');
        }
        if (shortPhone) {
          const before = snapshot(fixture); choose(fixture, '#note-dots', '1');
          await waitFor(fixture, () => !field(fixture, '#note-editor-error').hidden
            && /Voice contains.*meter allows/i.test(field(fixture, '#note-editor-error').textContent ?? ''), 'Show the rejected dotted whole in the short editor');
          await frames(fixture); await settle(fixture);
          unchanged(fixture, before, 'Rejected short-phone overflow');
          equal(field<HTMLSelectElement>(fixture, '#note-dots').value, '0', 'A rejected dot must restore the accepted native choice');
          assertInEditorBody(fixture, '#note-editor-error', 'Automatic visibility of the local overflow error');
          focusRetained(fixture, 'note-dots'); assertPopupBounds(fixture);
          await closeEditor(fixture); await openEditor(fixture); await frames(fixture);
          assert(field(fixture, '#note-editor-error').hidden, 'Reopening the editor must clear the previous local error.');
          assertCoreControlsVisible(fixture, 'Short-phone reopening after an error');
          unchanged(fixture, before, 'Closing and reopening after short-phone overflow');
        }
        const change = await quickChange(fixture, () => choose(fixture, '#note-duration', 'half'), () => eventById(fixture, 'viewport-note').duration === 'half', 'note-duration');
        assertPopupBounds(fixture);
        const select = field<HTMLSelectElement>(fixture, '#note-duration');
        await waitFor(fixture, () => (select.querySelector('selectedcontent')?.textContent ?? '').trim() === (select.selectedOptions[0]?.textContent ?? '').trim(), 'Reflect the accepted native option in selectedcontent');
        await undoQuick(fixture, change); await closeEditor(fixture); await frames(fixture);
        equal(fixture.doc.activeElement?.id, 'edit-selected-event', 'Native Close must return focus even at a short viewport');
      }
      return 'Both native selects retain labels, explicit values, selectedcontent, enhancement/fallback, and focus across all four 1180/390 × 760/360 viewports. At 390×360, duration and dots are immediately visible, a rejected overflow scrolls its local error into view, and reopening restores both controls without manual body scrolling. Trusted picker keyboard dismissal is not simulated.';
    },
  },
];

function visualReport(value: unknown): void {
  let output = document.querySelector<HTMLScriptElement>('#note-editor-visual-result');
  if (!output) { output = document.createElement('script'); output.id = 'note-editor-visual-result'; output.type = 'application/json'; document.body.append(output); }
  output.textContent = JSON.stringify(value, null, 2);
}
async function showVisual(width: number, height: number): Promise<void> {
  if (busy) return; setBusy(true); visualFixtures.replaceChildren();
  const label = width === 1180 ? 'Desktop' : height < 500 ? 'Short phone' : 'Phone';
  visualStatus.dataset.state = 'running'; visualStatus.textContent = `Preparing the actual ${label.toLowerCase()} note editor…`;
  visualReport({ state: 'running', scenario: 'native-note-editor', width, height });
  let fixture: Fixture | undefined;
  try {
    fixture = await mount(`${label} native note editor · ${width} × ${height}`, width, height, visualFixtures);
    await applySource(fixture, longSource());
    choose(fixture, '#measure-select', 'long-bar-7'); await frames(fixture); await settle(fixture); await selectEvent(fixture, 'long-note');
    fixture.frame.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); await frames(fixture);
    const before = snapshot(fixture); await openEditor(fixture); identity(fixture, 'long-note'); await frames(fixture); assertPopupBounds(fixture);
    if (width === 390 && height === 360) assertCoreControlsVisible(fixture, 'Short-phone visual fixture opening');
    unchanged(fixture, before, 'Opening the native visual fixture');
    equal(field(fixture, '#note-sharp').getAttribute('aria-pressed'), 'true', 'The visual fixture must show the accepted sharp as selected');
    equal(field<HTMLSelectElement>(fixture, '#note-duration').value, 'half', 'The visual fixture must show the accepted half-note value');
    visualStatus.dataset.state = 'ready';
    visualStatus.textContent = `${label} editor ready at ${width} × ${height}. This is the actual native popover for the accepted F#4 half note in measure 7. Sharp is selected; no note change was made while opening the fixture.`;
    const bounds = field(fixture, '#note-editor').getBoundingClientRect();
    visualReport({ state: 'ready', scenario: 'native-note-editor', workspace: fixture.workspace, url: fixture.frame.src,
      width, height, selectedEvent: 'long-note', selectedMeasure: 'long-bar-7', revision: revision(fixture), sourceUnchanged: true,
      popup: { open: editorOpen(fixture), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      heading: field(fixture, '#note-editor-heading').textContent, context: field(fixture, '#note-editor-context').textContent,
      sharp: field(fixture, '#note-sharp').getAttribute('aria-pressed'), duration: field<HTMLSelectElement>(fixture, '#note-duration').value,
      focusedControl: fixture.doc.activeElement?.id });
  } catch (error) {
    const detail = `${error instanceof Error ? error.message : String(error)}${fixture ? `\nActual fixture diagnostics:\n${diagnostic(fixture)}` : ''}`;
    visualStatus.dataset.state = 'failed'; visualStatus.textContent = detail; visualReport({ state: 'failed', scenario: 'native-note-editor', width, height, detail });
  } finally { setBusy(false); }
}

async function run(): Promise<void> {
  if (busy) return; setBusy(true); fixtures.replaceChildren(); visualFixtures.replaceChildren();
  for (const key of ownedKeys) localStorage.removeItem(key); ownedKeys.clear();
  results.replaceChildren(); token = crypto.randomUUID(); sequence = 0; transactions = 0; latestFixture = undefined;
  summary.dataset.state = 'running'; environment.textContent = `${navigator.userAgent}. Actual Author iframes, native popover/customizable selects, synthetic DOM actions. No private controller access.`;
  const report: Result[] = [];
  for (const [index, test] of tests.entries()) {
    summary.textContent = `Running ${index + 1}/${tests.length}: ${test.name}`;
    const item = document.createElement('li'); item.dataset.state = 'running'; const title = document.createElement('strong'); title.textContent = `Running: ${test.name}`; item.append(title); results.append(item);
    try {
      const detail = await test.run(); item.dataset.state = 'passed'; title.textContent = `PASS — ${test.name}`;
      const description = document.createElement('div'); description.textContent = detail; item.append(description); report.push({ name: test.name, passed: true, detail });
    } catch (error) {
      const detail = `${error instanceof Error ? error.message : String(error)}${latestFixture ? `\nActual fixture diagnostics:\n${diagnostic(latestFixture)}` : ''}`;
      item.dataset.state = 'failed'; title.textContent = `FAIL — ${test.name}`; const description = document.createElement('pre'); description.textContent = detail; item.append(description); report.push({ name: test.name, passed: false, detail });
    }
  }
  const passed = report.filter(result => result.passed).length; const failed = report.length - passed;
  summary.dataset.state = failed ? 'failed' : 'passed'; summary.textContent = `${passed}/${tests.length} note editor checks passed${failed ? `; ${failed} failed` : ''}. ${transactions} immediate transactions inspected. Trusted keyboard and picker interactions still require separate qualification.`;
  let output = document.querySelector<HTMLScriptElement>('#note-editor-browser-results');
  if (!output) { output = document.createElement('script'); output.id = 'note-editor-browser-results'; output.type = 'application/json'; document.body.append(output); }
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, transactions, results: report }, null, 2);
  setBusy(false);
}
runButton.addEventListener('click', () => { void run(); });
document.querySelector('#show-desktop-editor')!.addEventListener('click', () => { void showVisual(1180, 660); });
document.querySelector('#show-phone-editor')!.addEventListener('click', () => { void showVisual(390, 660); });
document.querySelector('#show-short-editor')!.addEventListener('click', () => { void showVisual(390, 360); });
