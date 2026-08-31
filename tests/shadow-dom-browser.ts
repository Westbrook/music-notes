import '../src/components/index.js';
import '../src/demo/workbook-toolbar.js';
import '../src/authoring/ui/panel-frame.js';
import '../src/authoring/ui/view-switch.js';
import '../src/authoring/ui/score-viewport.js';
import '../src/authoring/ui/source-editor.js';
import type { NotationViewportChangeDetail } from '../src/components/music-surface.js';
import { WorkbookState } from '../src/demo/workbook-state.js';
import { renderEventNavigator } from '../src/authoring/ui/event-navigator.js';
import type { EventNavigatorState, NavigateRequestDetail } from '../src/authoring/ui/event-navigator.js';
import { activeElement, composedAncestors, composedContains } from '../src/ui/composed-dom.js';
import { createPopoverPositioner } from '../src/authoring/popover-position.js';
import { focusInTools } from '../src/authoring/tool-pane-focus.js';
import { ControlScope } from '../src/authoring/control-scope.js';
import { parseMeter, parsePitch, rational } from '../src/model/index.js';
import type { MusicEvent } from '../src/model/types.js';
import type { ViewMode } from '../src/authoring/types.js';

interface Test { name: string; run: () => Promise<string> }
interface Result { name: string; passed: boolean; detail: string }
interface Metrics {
  navigatorUpdates?: number;
  navigatorUpdateMs?: number;
  navigatorNodesBefore?: number;
  navigatorNodesAfter?: number;
  shadowRoots?: number;
  nativeScrollEvents?: number;
  svgSystems?: number;
}

const runButton = document.querySelector<HTMLButtonElement>('#run')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const fixtures = document.querySelector<HTMLElement>('#fixtures')!;
const environment = document.querySelector<HTMLElement>('#environment')!;
const interactionLog = document.querySelector<HTMLElement>('#interaction-log')!;
const output = document.querySelector<HTMLScriptElement>('#shadow-dom-browser-results')!;
const cleanups: (() => void)[] = [];
let metrics: Metrics = {};
let running = false;
let sequence = 0;
let browserErrors: string[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`);
}

function close(actual: number, expected: number, message: string, tolerance = 1): void {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${message}: expected ${expected}, received ${actual}; tolerance ${tolerance}px.`);
}

function id(name: string): string { return `shadow-check-${++sequence}-${name}`; }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  value.textContent = text;
  return value;
}

function fixture(title: string, note: string): { article: HTMLElement; body: HTMLDivElement } {
  const article = element('article'); article.className = 'fixture';
  const caption = element('p', note); caption.className = 'fixture-note';
  const body = element('div'); body.className = 'fixture-body';
  article.append(element('h3', title), caption, body); fixtures.append(article);
  return { article, body };
}

async function bounded<T>(promise: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} did not complete within ${timeoutMs / 1000} seconds.`)), timeoutMs);
    })]);
  } finally { clearTimeout(timeout); }
}

async function frame(): Promise<void> { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }
async function frames(): Promise<void> { await frame(); await frame(); }
async function settled(...components: { updateComplete: Promise<unknown> }[]): Promise<void> {
  await Promise.resolve();
  await bounded(Promise.all(components.map(component => component.updateComplete)), 'Component update');
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  const deadline = performance.now() + 3_000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error(`${label} did not complete within 3 seconds.`);
    await frame();
  }
}

function checkDescriptions(control: HTMLElement): void {
  const root = control.getRootNode() as Document | ShadowRoot;
  const ids = (control.getAttribute('aria-describedby') ?? '').trim().split(/\s+/).filter(Boolean);
  assert(ids.length > 0, 'The control must reference a same-tree accessible description.');
  for (const descriptionId of ids) assert(root.getElementById(descriptionId), `Description ${descriptionId} must resolve in the control’s own tree.`);
}

function countShadowRoots(root: ParentNode): number {
  let count = 0;
  for (const node of root.querySelectorAll('*')) if (node.shadowRoot) count += 1 + countShadowRoots(node.shadowRoot);
  return count;
}

function navigatorState(events: readonly MusicEvent[]): EventNavigatorState {
  return {
    measure: {
      id: 'navigator-bar', number: '1', meter: parseMeter(4, 4), clef: 'treble', key: 'C',
      voices: [{ id: 'navigator-voice', events, tuplets: [] }], annotations: [],
      breakBefore: 'auto', keepWithNext: false, endBar: 'single', repeatStart: false, pickup: false, incomplete: false,
    }, voiceIndex: 0, selectedIds: [],
  };
}

function note(sourceId: string, pitch = 'C4'): MusicEvent {
  return { id: sourceId, kind: 'note', pitches: [parsePitch(pitch)], duration: 'quarter', dots: 0,
    onset: rational(0), time: rational(1, 4), tupletIds: [], beam: 'auto', stem: 'auto',
    tie: 'none', measureRest: false, rhythmic: false };
}

function forwardedFields(body: HTMLElement) {
  const host = element('div'); host.className = 'probe';
  const root = host.attachShadow({ mode: 'open' });
  const outer = element('aside'); outer.className = 'workspace-tools';
  outer.style.cssText = 'height:180px;overflow:auto;border:1px solid #789;padding:0;';
  const bridge = element('div'); bridge.style.cssText = 'display:block;margin-top:65px;margin-bottom:90px;';
  const forward = element('slot'); forward.name = 'fields'; forward.slot = 'fields';
  bridge.append(forward); outer.append(bridge); root.append(outer);
  const bridgeRoot = bridge.attachShadow({ mode: 'open' });
  const inner = element('section'); inner.className = 'tool-panel';
  inner.style.cssText = 'height:135px;overflow:auto;border:1px solid #9ab;padding:0;';
  const slot = element('slot'); slot.name = 'fields'; inner.append(slot); bridgeRoot.append(inner);
  const payload = element('div'); payload.slot = 'fields'; payload.style.cssText = 'min-height:650px;padding:30px 10px 160px;';
  const invoker = element('button', 'Open anchored panel'); invoker.type = 'button';
  const label = element('label', 'Pitch in a forwarded field'); label.style.cssText = 'display:grid;gap:5px;margin-top:245px;';
  const field = element('input'); field.type = 'text'; field.defaultValue = 'C4'; label.append(field);
  payload.append(invoker, label); host.append(payload); body.append(host);
  return { host, root, outer, bridge, bridgeRoot, inner, forward, slot, payload, invoker, label, field };
}

function verticallyVisible(field: HTMLElement, scroller: HTMLElement, label: string): void {
  const bounds = scroller.getBoundingClientRect(), target = field.getBoundingClientRect();
  const top = bounds.top + scroller.clientTop;
  assert(target.top >= top - 1 && target.bottom <= top + scroller.clientHeight + 1, `${label} must reveal the focused field within its actual client box.`);
}

const tests: Test[] = [
  {
    name: 'Independent toolbar state, native descriptions, and caller-owned slots',
    async run() {
      const { body } = fixture('Two independent workbooks', 'Both shadow trees deliberately use the same internal IDs. Slotted actions and links remain caller-owned.');
      body.className += ' fixture-row';
      const first = element('music-workbook-toolbar'), second = element('music-workbook-toolbar');
      first.idPrefix = ''; second.idPrefix = ''; first.sourceHref = '#fixtures-heading';
      const previews: boolean[][] = [[], []]; let printRequests = 0;
      const models = previews.map(changes => new WorkbookState({
        readScores: () => [], applyPreview: checked => changes.push(checked), requestPrint: () => { printRequests++; },
      }));
      cleanups.push(() => models.forEach(model => model.dispose()));
      first.model = models[0]; second.model = models[1];
      const action = element('button', 'Caller action'); action.type = 'button'; action.slot = 'actions';
      const link = element('a', 'Caller documentation'); link.href = '#fixtures-heading'; link.slot = 'links';
      let actionCount = 0; action.addEventListener('click', () => { actionCount++; });
      first.append(action, link); body.append(first, second); await settled(first, second);
      const firstRoot = first.shadowRoot!, secondRoot = second.shadowRoot!;
      const preview = firstRoot.querySelector<HTMLInputElement>('#print-preview')!;
      const otherPreview = secondRoot.querySelector<HTMLInputElement>('#print-preview')!;
      const printButton = firstRoot.querySelector<HTMLButtonElement>('#print-scores')!;
      assert(preview.labels?.[0]?.control === preview, 'The native checkbox must retain a label in its own root.');
      checkDescriptions(preview); checkDescriptions(printButton);
      assert(firstRoot.querySelector('[role="group"]')?.getAttribute('aria-label') === 'Score display controls', 'The local toolbar group must have its accessible name.');
      assert(firstRoot.querySelector('[role="status"]')?.getAttribute('aria-live') === 'polite', 'Toolbar status must remain a local polite live region.');
      assert(action.assignedSlot === firstRoot.querySelector('slot[name="actions"]'), 'The action must be assigned to the actual native action slot.');
      assert(link.assignedSlot === firstRoot.querySelector('slot[name="links"]'), 'The link must be assigned to the actual native links slot.');
      assert(firstRoot.querySelector<HTMLAnchorElement>('.source-link')!.getClientRects().length === 0, 'Assigned links must suppress the fallback link’s rendered box.');
      preview.click(); await settled(first, second);
      assert(models[0].view.get().preview && !models[1].view.get().preview, 'Preview activation must change only the bound model.');
      assert(preview.checked && !otherPreview.checked, 'Independent shadow controls must show independent state.');
      action.focus(); action.click(); models[0].setPreview(false); await settled(first);
      assert(firstRoot.querySelector('#print-preview') === preview, 'State updates must preserve the native checkbox.');
      assert(document.activeElement === action && action.parentElement === first, 'A focused slotted action must remain the same light-DOM node.');
      assert(actionCount === 1 && printRequests === 0, 'Caller actions must retain their listener without requesting printing.');
      link.remove(); await frames();
      assert(firstRoot.querySelector<HTMLSlotElement>('slot[name="links"]')!.assignedElements().length === 0, 'Removing the caller link must empty its slot.');
      assert(firstRoot.querySelector<HTMLAnchorElement>('.source-link')!.getClientRects().length > 0, 'The configured fallback link must become visibly rendered.');
      first.append(link); await frames();
      const externalLabel = element('label', 'Outside label cannot capture a private checkbox'); externalLabel.htmlFor = 'print-preview'; body.append(externalLabel);
      assert(externalLabel.control === null && document.getElementById('print-preview') === null, 'Document ID references must not reach private toolbar controls.');
      equal(previews[1], [false], 'The second model must not receive first-toolbar changes.');
      return 'Native shadow labels/help resolve locally; slots retain node identity, focus, listener ownership and fallback behavior. Scripted checkbox activation changes only its own signal model.';
    },
  },
  {
    name: 'Slotted panels preserve native labels, forms, submission, and reset',
    async run() {
      const { body } = fixture('Caller-owned native form', 'The complete field groups are slotted together; form ownership and label association remain in their logical DOM tree.');
      const form = element('form'), panel = element('music-panel-frame'); panel.className = 'panel-demo';
      const heading = element('h4', 'Composition fields'); heading.slot = 'header';
      const content = element('div'); content.slot = 'body';
      const title = element('input'); title.id = id('title'); title.name = 'title'; title.defaultValue = 'Initial melody';
      const label = element('label', 'Composition title'); label.htmlFor = title.id;
      const checkbox = element('input'); checkbox.type = 'checkbox'; checkbox.id = id('reviewed'); checkbox.name = 'reviewed'; checkbox.defaultChecked = true;
      const checkLabel = element('label', 'Reviewed'); checkLabel.htmlFor = checkbox.id;
      const meter = element('select'); meter.name = 'meter'; meter.id = id('meter');
      meter.add(new Option('Four four', '4/4', true, true)); meter.add(new Option('Three four', '3/4'));
      const meterLabel = element('label', 'Meter'); meterLabel.htmlFor = meter.id;
      content.append(label, title, checkLabel, checkbox, meterLabel, meter);
      const footer = element('div'); footer.slot = 'footer';
      const submit = element('button', 'Submit native form'); submit.type = 'submit'; submit.name = 'intent'; submit.value = 'save';
      const reset = element('button', 'Reset native form'); reset.type = 'reset'; footer.append(submit, reset);
      panel.append(heading, content, footer); form.append(panel); body.append(form); panel.mount();
      assert(content.assignedSlot === panel.shadowRoot!.querySelector('slot[name="body"]'), 'The whole body must be assigned without moving its form fields.');
      assert(label.control === title && title.labels?.[0] === label && meterLabel.control === meter, 'Native label relationships must survive slotting.');
      assert([title, checkbox, meter, submit, reset].every(control => control.form === form), 'Every caller-owned control must retain the outer form.');
      title.value = 'Edited melody'; meter.value = '3/4'; checkLabel.click();
      assert(!checkbox.checked, 'Native label activation must toggle its associated checkbox.');
      checkbox.checked = true;
      let submitted: [string, FormDataEntryValue][] | undefined; let submitter: HTMLElement | null = null;
      form.addEventListener('submit', event => {
        event.preventDefault(); submitter = (event as SubmitEvent).submitter;
        submitted = [...new FormData(form, submit)];
      });
      form.requestSubmit(submit);
      assert(submitter === submit, 'Native submission must identify the actual slotted submitter.');
      equal(submitted, [['title', 'Edited melody'], ['reviewed', 'on'], ['meter', '3/4'], ['intent', 'save']], 'Successful slotted controls must participate in native FormData.');
      title.focus(); panel.requestUpdate(); await settled(panel);
      assert(document.activeElement === title && title.parentElement === content, 'Panel updates must preserve the actual focused field and logical parent.');
      reset.click();
      equal([title.value, checkbox.checked, meter.value], ['Initial melody', true, '4/4'], 'Native reset must restore the original defaults.');
      assert(panel.shadowRoot!.querySelector('input,select,form') === null, 'The frame must not copy or proxy its caller’s form controls.');
      return 'Real label activation, requestSubmit, FormData, reset defaults, form ownership and focus remain intact through a native panel slot; no form navigation occurs.';
    },
  },
  {
    name: 'Disabled fieldsets use logical ancestry; inertness follows rendered slots',
    async run() {
      const { body } = fixture('Disabled and inert boundaries', 'This matrix distinguishes logical form ancestry from the flat tree used for presentation and inertness.');
      const form = element('form'), fieldset = element('fieldset'), legend = element('legend');
      const exempt = element('input'); exempt.name = 'legend'; exempt.defaultValue = 'legend value'; legend.append('First legend field ', exempt);
      const panel = element('music-panel-frame'), content = element('div'); content.slot = 'body';
      const light = element('input'); light.name = 'light'; light.defaultValue = 'light value';
      const label = element('label', 'Slotted light field'); label.append(light);
      const probe = element('div'); probe.className = 'probe'; const probeRoot = probe.attachShadow({ mode: 'open' });
      const privateLabel = element('label', 'Private shadow field '), privateInput = element('input'); privateInput.name = 'private'; privateLabel.append(privateInput); probeRoot.append(privateLabel);
      content.append(label, probe); panel.append(content); fieldset.append(legend, panel); form.append(fieldset);
      const outside = element('button', 'Outside focus target'); outside.type = 'button'; body.append(form, outside); panel.mount();
      fieldset.disabled = true;
      assert(!light.disabled && light.matches(':disabled'), 'The slotted light field must inherit disabledness without changing its own disabled property.');
      assert(!exempt.matches(':disabled'), 'The first logical legend must retain its native disabled-fieldset exception.');
      assert(!privateInput.matches(':disabled') && privateInput.form === null, 'An outer disabled fieldset and form must not acquire a private shadow input.');
      equal([...new FormData(form)], [['legend', 'legend value']], 'Disabled light controls must be excluded from submission; private fields have no outer form owner.');
      outside.focus(); light.focus(); assert(document.activeElement === outside, 'Native focus must refuse a field disabled by its logical ancestor.');
      privateInput.focus(); assert(activeElement(document) === privateInput, 'The private shadow field remains focusable while only the outer logical fieldset is disabled.');
      fieldset.disabled = false; fieldset.inert = true;
      outside.focus(); light.focus(); privateInput.focus(); exempt.focus();
      assert(document.activeElement === outside, 'Inertness must block focus across both native slots and a nested shadow root, including the legend.');
      assert(!light.matches(':disabled') && new FormData(form).get('light') === 'light value', 'Inertness must not be mistaken for disabled form state.');
      fieldset.inert = false;

      const inverse = element('div'); inverse.className = 'probe'; const inverseRoot = inverse.attachShadow({ mode: 'open' });
      const shadowFieldset = element('fieldset'); shadowFieldset.disabled = true;
      const slot = element('slot'); const shadowLabel = element('label', 'A shadow label is not a light control label'); shadowLabel.htmlFor = id('inverse-field');
      shadowFieldset.append(shadowLabel, slot); inverseRoot.append(shadowFieldset);
      const inverseInput = element('input'); inverseInput.id = shadowLabel.htmlFor; inverseInput.name = 'inverse'; inverseInput.defaultValue = 'projected value'; inverse.append(inverseInput); form.append(inverse); await frames();
      assert(inverseInput.assignedSlot === slot, 'The inverse fixture must use a real browser slot.');
      assert(!inverseInput.matches(':disabled') && inverseInput.form === form && shadowLabel.control === null, 'A shadow wrapper must not invent native fieldset or label relationships with assigned light controls.');
      inverseInput.focus(); assert(document.activeElement === inverseInput, 'A shadow disabled fieldset must leave assigned light controls focusable.');
      shadowFieldset.inert = true; outside.focus(); inverseInput.focus();
      assert(document.activeElement === outside, 'An inert shadow wrapper must block focus on its assigned light control.');
      assert(new FormData(form).get('inverse') === 'projected value', 'An inert projected field still has its original form association.');
      shadowFieldset.inert = false;
      return 'Native :disabled, first-legend exceptions, focus refusal, and FormData confirm logical ancestry. Inertness crosses actual slot/shadow boundaries without changing form state.';
    },
  },
  {
    name: 'View requests cross shadow roots while accepted mode and focus stay stable',
    async run() {
      const { body } = fixture('Independent view switch', 'Buttons emit a transition request; the fixture deliberately accepts the state separately.');
      const host = element('div'), root = host.attachShadow({ mode: 'open' });
      const switcher = element('music-view-switch'); root.append(switcher); body.append(host); switcher.mount();
      const read = switcher.shadowRoot!.querySelector<HTMLButtonElement>('#view-read')!;
      const pressed = () => [...switcher.shadowRoot!.querySelectorAll('button[aria-pressed="true"]')].map(button => button.textContent?.trim());
      assert(switcher.shadowRoot!.querySelector('nav')?.getAttribute('aria-label') === 'Workspace view', 'The local view navigation must keep its accessible name.');
      const requests: ViewMode[] = []; let composed = false; let eventPath: EventTarget[] = [];
      body.addEventListener('view-request', event => { requests.push(event.detail.mode); composed = event.composed; eventPath = event.composedPath(); });
      read.focus(); read.click();
      equal(requests, ['read'], 'One native button activation must emit one view request.');
      assert(composed && eventPath.includes(switcher) && eventPath.includes(host), 'The explicit request must cross the outer shadow boundary.');
      equal(pressed(), ['Write'], 'A request must not mutate the owner’s accepted mode.');
      switcher.mode = 'read'; await settled(switcher);
      equal(pressed(), ['Read'], 'Publishing the accepted mode must update aria-pressed.');
      assert(switcher.shadowRoot!.querySelector('#view-read') === read && activeElement(document) === read, 'The actual focused native button must survive the state update.');
      assert(document.activeElement === host && root.activeElement === switcher, 'Native focus must retarget through each shadow host.');
      return 'Native button activation emits one composed request. Accepted-state rendering preserves button identity, local naming, aria-pressed and the deepest focused button.';
    },
  },
  {
    name: 'Navigator modifiers, keyed controls, focus repair, and bounded update measurements',
    async run() {
      const { body } = fixture('Keyed event navigator', 'The modifier event below is explicitly synthetic; focus, node retention and browser DOM updates are real.');
      const host = element('div'), root = host.attachShadow({ mode: 'open' });
      const navigator = element('music-event-navigator'), fallback = element('button', 'Return to score');
      root.append(navigator, fallback); body.append(host);
      const first = note('nav-a'), second = note('nav-b', 'D4');
      renderEventNavigator(navigator, navigatorState([first, second]), fallback);
      const navigatorRoot = navigator.shadowRoot!;
      const button = (sourceId: string) => [...navigatorRoot.querySelectorAll<HTMLButtonElement>('button')].find(item => item.dataset.sourceId === sourceId)!;
      const a = button(first.id), b = button(second.id); const intents: NavigateRequestDetail[] = []; let composed = false;
      body.addEventListener('navigate-request', event => { intents.push(event.detail); composed = event.composed; });
      const gesture = new MouseEvent('click', { bubbles: true, composed: true, shiftKey: true, metaKey: true, ctrlKey: true, altKey: true });
      a.dispatchEvent(gesture);
      equal(intents, [{ sourceId: first.id, shiftKey: true, metaKey: true, ctrlKey: true, altKey: true }], 'All modifiers must cross the component event boundary exactly once.');
      assert(composed && !gesture.isTrusted, 'Modifier routing is composed and must be reported as synthetic.');
      assert(a.getAttribute('aria-pressed') === 'false', 'Emitting navigation must not change accepted selection itself.');
      b.focus();
      const accepted = { ...navigatorState([second, first]), selectedIds: [second.id] };
      navigator.renderState(accepted, fallback);
      assert(button(first.id) === a && button(second.id) === b && activeElement(document) === b, 'Keyed reorder must preserve both buttons and deepest focus.');
      const countBefore = navigatorRoot.querySelectorAll('*').length;
      const started = performance.now();
      for (let index = 0; index < 60; index++) navigator.renderState({
        ...navigatorState([{ ...second, dots: index % 2 }, first]), selectedIds: index % 2 ? [first.id] : [second.id],
      }, fallback);
      metrics.navigatorUpdateMs = Number((performance.now() - started).toFixed(2)); metrics.navigatorUpdates = 60;
      metrics.navigatorNodesBefore = countBefore; metrics.navigatorNodesAfter = navigatorRoot.querySelectorAll('*').length;
      assert(navigator.shadowRoot === navigatorRoot && button(second.id) === b && activeElement(document) === b, 'Repeated updates must retain the same root and focused node.');
      navigator.renderState(navigatorState([first]), fallback);
      assert(activeElement(document) === a, 'Removing the focused event must move focus to a surviving native event button.');
      navigator.renderState(navigatorState([]), fallback);
      assert(activeElement(document) === fallback, 'Removing the last focused event must use the supplied score fallback.');
      navigator.renderState(accepted, fallback); assert(activeElement(document) === fallback, 'A later update must not steal unrelated focus.');
      return `Synthetic modifiers route exactly once; native focused nodes survive reordering and update loops. ${metrics.navigatorUpdates} synchronous updates took ${metrics.navigatorUpdateMs}ms; element count ${metrics.navigatorNodesBefore} → ${metrics.navigatorNodesAfter}. Timing is reported without a pass threshold.`;
    },
  },
  {
    name: 'Forwarded native slots reveal fields through composed scroll ancestors',
    async run() {
      const { article, body } = fixture('Nested tools scrolling', 'Two real scrollports live in separate shadow roots; a native light field reaches them through forwarded slots.');
      const scoreScroll = element('div'); scoreScroll.style.cssText = 'height:70px;width:180px;overflow:auto;border:1px solid #abc;';
      const scoreFiller = element('div', 'Unrelated score scroll position'); scoreFiller.style.height = '400px'; scoreScroll.append(scoreFiller); body.append(scoreScroll);
      const f = forwardedFields(body); await frames(); article.scrollIntoView({ block: 'center' }); await frames();
      assert(f.payload.assignedSlot === f.forward && f.forward.assignedSlot === f.slot, 'Both forwarding edges must be native assignedSlot relationships.');
      const ancestors = [...composedAncestors(f.field)];
      assert([f.forward, f.slot, f.inner, f.outer].every(node => ancestors.includes(node)), 'Composed ancestry must include both slots and both scrollports.');
      assert(!f.inner.contains(f.field) && composedContains(f.inner, f.field), 'Logical containment must remain distinct from projected containment.');
      f.inner.scrollTop = 0; f.outer.scrollTop = 0; scoreScroll.scrollTop = 31; await frames();
      const documentScroll = window.scrollY, scorePosition = scoreScroll.scrollTop;
      focusInTools(f.field); await frames();
      assert(activeElement(document) === f.field && document.activeElement === f.field, 'The slotted light field must retain actual document focus.');
      assert(f.inner.scrollTop > 0 && f.outer.scrollTop > 0, 'Both real scrollports must reveal the previously clipped field.');
      verticallyVisible(f.field, f.inner, 'Inner tools'); verticallyVisible(f.field, f.outer, 'Outer tools');
      close(window.scrollY, documentScroll, 'Tools focus must preserve document scrolling');
      close(scoreScroll.scrollTop, scorePosition, 'Tools focus must preserve score scrolling');
      return 'Native slot forwarding exposes both scroll ancestors. Measured field bounds fit both client boxes after focusInTools, while document and unrelated score offsets remain unchanged.';
    },
  },
  {
    name: 'Native private scroll events reposition an outer popover through forwarded slots',
    async run() {
      const { article, body } = fixture('Anchored panel across forwarded slots', 'Changing a real private scroll offset must move the open native panel without replacing it or changing focus.');
      assert('showPopover' in HTMLElement.prototype, 'This check needs native popover support.');
      const f = forwardedFields(body); const panel = element('section', 'A native anchored popover.');
      panel.id = id('anchor-panel'); panel.setAttribute('popover', 'auto'); panel.className = 'test-popover anchor-popover';
      panel.setAttribute('aria-label', 'Anchored panel test'); body.append(panel);
      f.invoker.setAttribute('popovertarget', panel.id);
      const positioner = createPopoverPositioner({ panel, preferredSide: 'below', gap: 8 });
      cleanups.push(() => positioner.dispose());
      await frames(); f.outer.scrollTop = 65; article.scrollIntoView({ block: 'center' }); await frames();
      f.invoker.focus({ preventScroll: true }); f.invoker.click();
      assert(panel.matches(':popover-open'), 'Native popovertarget activation must open the same-tree panel.');
      positioner.open(f.invoker); await frames();
      const initialPanelTop = panel.getBoundingClientRect().top, initialAnchorTop = f.invoker.getBoundingClientRect().top;
      let scrolls = 0; let native = false; let composed = true;
      f.inner.addEventListener('scroll', event => { scrolls++; native ||= event.isTrusted; composed = event.composed; });
      try {
        f.inner.scrollTop = 18;
        await until(() => scrolls > 0 && Math.abs(panel.getBoundingClientRect().top - initialPanelTop) > 1, 'Native private scrolling and panel positioning');
        const anchorDelta = f.invoker.getBoundingClientRect().top - initialAnchorTop;
        close(panel.getBoundingClientRect().top - initialPanelTop, anchorDelta, 'The panel must follow its actual projected anchor');
        assert(native && !composed, 'A browser-generated noncomposed scroll must cross the component’s explicit positioning subscription.');
        assert(activeElement(document) === f.invoker, 'Positioning must preserve the actual native invoker focus.');
        metrics.nativeScrollEvents = (metrics.nativeScrollEvents ?? 0) + scrolls;
      } finally { panel.hidePopover(); positioner.close(); }
      return 'A real private scroll generated a trusted, noncomposed browser event. The positioner followed its projected anchor by the measured scroll delta and retained focus; no synthetic scroll event was dispatched.';
    },
  },
  {
    name: 'Score viewport retains owned mounts and keeps musical IDs outside application scope',
    async run() {
      const { body } = fixture('Encapsulated score viewport', 'Accepted musical source, selection decoration, and gesture preview occupy separate stable mounts. The score intentionally shares an ID with an outside button.');
      const collision = id('shared-control'); const outside = element('button', 'Outside application control'); outside.id = collision; outside.type = 'button';
      const shell = element('div'), shellRoot = shell.attachShadow({ mode: 'open' });
      const viewport = element('music-score-viewport'); viewport.style.cssText = 'width:min(660px,100%);'; shellRoot.append(viewport); body.append(outside, shell); viewport.mount();
      const action = element('button', 'Score action'); action.type = 'button'; action.slot = 'actions';
      const help = element('p', 'Caller-owned keyboard help'); help.slot = 'help'; viewport.append(action, help);
      const score = element('music-system'); score.label = 'Shadow boundary study';
      const staff = element('music-staff'), measure = element('music-measure'), authoredNote = element('music-note');
      authoredNote.id = collision; authoredNote.pitch = 'C4'; authoredNote.duration = 'whole'; measure.append(authoredNote); staff.append(measure); score.append(staff);
      const scoreMount = viewport.scoreMount, selectionMount = viewport.overlayMount, previewMount = viewport.previewMount;
      scoreMount.append(score); const selection = element('div'), preview = element('div'); selectionMount.append(selection); previewMount.append(preview);
      await bounded(score.refresh(), 'Actual score engraving'); await bounded(score.renderComplete, 'Score completion');
      assert(!score.diagnostics.some(item => item.severity === 'error'), 'The musical fixture must engrave without notation errors.');
      assert(score.getSource(collision) === authoredNote, 'Musical source lookup must resolve the accepted note, independently of application IDs.');
      const scope = new ControlScope(body);
      assert(document.getElementById(collision) === outside && scope.getElementById(collision) === outside, 'Document and application control lookup must not discover score-owned IDs.');
      const svg = score.shadowRoot!.querySelector('svg.notation-svg'); assert(svg, 'The viewport must contain actual measured SVG notation.');
      action.focus(); viewport.requestUpdate(); await settled(viewport);
      assert(viewport.scoreMount === scoreMount && viewport.overlayMount === selectionMount && viewport.previewMount === previewMount, 'Lit viewport updates must retain all controller-owned mounts.');
      assert(score.parentElement === scoreMount && score.shadowRoot!.querySelector('svg.notation-svg') === svg, 'Unrelated viewport updates must not replace accepted source or its SVG.');
      assert(action.assignedSlot === viewport.shadowRoot!.querySelector('slot[name="actions"]') && help.assignedSlot === viewport.shadowRoot!.querySelector('slot[name="help"]'), 'Score actions/help must remain real native slot assignments.');
      assert(activeElement(document) === action, 'A slotted score action must keep actual focus.');
      selectionMount.replaceChildren(); assert(preview.parentElement === previewMount, 'Clearing selection decoration must leave gesture previews intact.');
      assert(selectionMount.getAttribute('aria-hidden') === 'true' && previewMount.getAttribute('aria-hidden') === 'true', 'Decorative mounts must remain excluded from accessible content.');
      const overflow = element('div'); overflow.style.cssText = 'width:1000px;height:1px;'; overflow.setAttribute('aria-hidden', 'true'); scoreMount.append(overflow);
      let events = 0; let scroller: HTMLElement | undefined; let composed = false;
      body.addEventListener('notation-viewport-change', event => {
        events++; scroller = (event as CustomEvent<NotationViewportChangeDetail>).detail.scroller; composed = event.composed;
      });
      scoreMount.scrollLeft = 30; await until(() => events > 0, 'Private score viewport scroll notification');
      assert(scroller === scoreMount && composed, 'Native private score scrolling must emit its explicit composed viewport event.');
      metrics.svgSystems = score.shadowRoot!.querySelectorAll('.screen svg.notation-svg').length;
      return `Real SVG and accepted source survive viewport updates; three mounts and slotted actions retain identity. Application scope ignores the colliding musical ID. ${metrics.svgSystems} screen SVG system(s) rendered, and private scrolling emitted the public viewport event.`;
    },
  },
  {
    name: 'Source editor owns native labels/status and returns focus through an outer popover',
    async run() {
      const { article, body } = fixture('Source draft in a native outer popover', 'The textarea, its label and feedback share one shadow root; the outer native popover owns opening, dismissal and return focus.');
      assert('showPopover' in HTMLElement.prototype, 'This check needs native popover support.');
      const invoker = element('button', 'Open Source fixture'); invoker.type = 'button';
      const panel = element('section'); panel.id = id('source-panel'); panel.setAttribute('popover', 'auto'); panel.className = 'test-popover';
      const frame = element('music-panel-frame'), heading = element('div'); heading.slot = 'header';
      const title = element('h3', 'Musical HTML'); title.id = id('source-heading'); panel.setAttribute('aria-labelledby', title.id);
      const closeButton = element('button', 'Close Source'); closeButton.type = 'button'; closeButton.setAttribute('popovertarget', panel.id); closeButton.setAttribute('popovertargetaction', 'hide');
      heading.append(title, closeButton); const content = element('div'); content.slot = 'body'; content.className = 'popover-body';
      const editor = element('music-source-editor'); content.append(editor); frame.append(heading, content); panel.append(frame); body.append(invoker, panel);
      invoker.setAttribute('popovertarget', panel.id); frame.mount();
      const initial = { documentId: id('source-document'), value: '<music-staff></music-staff>', status: 'Accepted source ready.', readOnly: false };
      editor.renderState(initial, { forceValue: true });
      const root = editor.shadowRoot!, input = root.querySelector<HTMLTextAreaElement>('#source-input')!, status = root.querySelector<HTMLElement>('#source-status')!, error = root.querySelector<HTMLElement>('#source-error')!;
      assert(input.labels?.[0]?.textContent?.trim() === 'Musical HTML source', 'Source must have its native label in the same shadow root.');
      checkDescriptions(input);
      assert(status.getAttribute('role') === 'status' && error.getAttribute('role') === 'alert', 'Status and validation feedback must retain their local accessibility roles.');
      assert(document.getElementById('source-input') === null, 'Document ID queries must not discover the private source textarea.');
      article.scrollIntoView({ block: 'center' }); await frames(); invoker.focus(); invoker.click(); await frames();
      assert(panel.matches(':popover-open'), 'The outer same-tree native invoker must open the Source popover.');
      editor.focusInput(); assert(activeElement(document) === input && document.activeElement === editor, 'Source focus must reach the actual shadow textarea.');
      const draft = '<music-staff label="An unapplied draft"></music-staff>';
      const changes: string[] = [], applications: string[] = []; let changeComposed = false; let reverts = 0;
      body.addEventListener('source-change', event => { changes.push(event.detail.value); changeComposed = event.composed; });
      body.addEventListener('source-apply', event => { applications.push(event.detail.value); });
      body.addEventListener('source-revert', () => { reverts++; });
      input.value = draft; input.setSelectionRange(3, 13); input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: 'draft' }));
      editor.renderState({ ...initial, status: 'Recoverable draft waiting.' });
      equal(changes, [draft], 'The explicit source-change intent must carry the local draft once.');
      assert(changeComposed && editor.inputValue === draft && input.selectionStart === 3 && input.selectionEnd === 13, 'A focused local edit and selection must survive accepted-status updates.');
      assert(root.querySelector('#source-input') === input && status.textContent === 'Recoverable draft waiting.', 'Status updates must retain the textarea and publish local status.');
      const failure = '<script>not executable</script> Finish the musical draft.';
      editor.fail(initial.documentId, draft, failure);
      assert(input.getAttribute('aria-invalid') === 'true' && !error.hidden && error.textContent === failure && !error.querySelector('script'), 'Validation prose must stay literal text with same-root invalid/error state.');
      root.querySelector<HTMLButtonElement>('#source-apply')!.click(); root.querySelector<HTMLButtonElement>('#source-revert')!.click();
      equal(applications, [draft], 'Apply intent must carry the current draft, without applying music itself.'); assert(reverts === 1, 'Revert must emit one explicit request.');
      assert(editor.inputValue === draft, 'Source actions must leave accepted-state decisions with their owner.');
      editor.clearFailure(); assert(!input.hasAttribute('aria-invalid') && error.hidden, 'Clearing feedback must remove the native invalid state.');
      editor.focusInput(); closeButton.click(); await frames();
      assert(!panel.matches(':popover-open') && document.activeElement === invoker, 'Native popover dismissal must restore the exact outer invoker from a shadow textarea.');
      return 'Native Source labels/descriptions/status resolve in one root; scripted input emits explicit value intents while preserving draft selection. Native popovertarget dismissal restores the outer invoker without scripted focus restoration.';
    },
  },
];

async function run(): Promise<void> {
  if (running) return;
  for (const cleanup of cleanups.splice(0)) cleanup();
  fixtures.replaceChildren(); results.replaceChildren(); metrics = {}; browserErrors = []; running = true; runButton.disabled = true;
  summary.dataset.state = 'running'; output.textContent = JSON.stringify({ state: 'running' });
  environment.textContent = `${navigator.userAgent}; devicePixelRatio ${window.devicePixelRatio}; native popovers ${'showPopover' in HTMLElement.prototype ? 'available' : 'unavailable'}. DOM/slot/form/focus and real scroll geometry checks; no screen-reader, trusted keyboard/touch, or printing qualification.`;
  const report: Result[] = [];
  for (const [index, test] of tests.entries()) {
    summary.textContent = `Running ${index + 1}/${tests.length}: ${test.name}`;
    const item = element('li'), name = element('strong', `Running: ${test.name}`); item.append(name); results.append(item);
    try {
      const detail = await bounded(test.run(), test.name, 25_000);
      item.dataset.state = 'passed'; name.textContent = `PASS — ${test.name}`; item.append(element('div', detail));
      report.push({ name: test.name, passed: true, detail });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      item.dataset.state = 'failed'; name.textContent = `FAIL — ${test.name}`; item.append(element('pre', detail));
      report.push({ name: test.name, passed: false, detail });
    }
  }
  await frames();
  if (browserErrors.length) {
    const detail = browserErrors.join('\n'); const item = element('li'); item.dataset.state = 'failed';
    item.append(element('strong', 'FAIL — Unhandled browser errors'), element('pre', detail)); results.append(item);
    report.push({ name: 'Unhandled browser errors', passed: false, detail });
  }
  metrics.shadowRoots = countShadowRoots(fixtures);
  const passed = report.filter(result => result.passed).length, failed = report.length - passed;
  summary.dataset.state = failed ? 'failed' : 'passed';
  summary.textContent = `${passed}/${report.length} shadow component checks passed${failed ? `; ${failed} failed` : ''}. Live fixtures and measured results remain below.`;
  output.textContent = JSON.stringify({ state: summary.dataset.state, passed, failed, metrics, results: report, browserErrors }, null, 2);
  running = false; runButton.disabled = false;
}

window.addEventListener('error', event => { if (running) browserErrors.push(event.message); });
window.addEventListener('unhandledrejection', event => { if (running) browserErrors.push(String(event.reason)); });
fixtures.addEventListener('click', event => {
  const control = event.composedPath().find(node => node instanceof HTMLElement && node.matches('button,input,select,a,textarea')) as HTMLElement | undefined;
  interactionLog.textContent = `Last originating click: ${control?.localName ?? '(background)'} ${control?.textContent?.trim().slice(0, 70) ?? ''}; isTrusted=${event.isTrusted}.`;
  interactionLog.dataset.trusted = String(event.isTrusted);
}, { capture: true });
runButton.addEventListener('click', () => { void run(); });
if (new URL(location.href).searchParams.get('run') === '1') void run();
