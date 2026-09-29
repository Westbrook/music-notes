import '../src/ui/toggle-button-group.js';
import type { MusicToggleButtonGroup } from '../src/ui/toggle-button-group.js';
import type { NativeOption } from '../src/ui/native-options.js';
import { phDotsThree } from '../src/ui/icons/phosphor/dots-three.js';
import { ENTRY_ACCIDENTAL_OPTIONS, ENTRY_ATTACK_OPTIONS, ENTRY_DOTS_OPTIONS, ENTRY_DURATION_OPTIONS } from '../src/authoring/entry-palette.js';

interface GroupFixture {
  readonly group: MusicToggleButtonGroup;
  readonly frame: HTMLElement;
  readonly status: HTMLElement;
}

const query = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing fixture element: ${selector}`);
  return element;
};
const widthInput = query<HTMLInputElement>('#container-width');
const runButton = query<HTMLButtonElement>('#run-checks');
const summary = query<HTMLElement>('#summary');
const outcomes = query<HTMLOListElement>('#outcomes');
const enhanced = CSS.supports('appearance', 'base-select') && CSS.supports('selector(::picker(select))');
query('#environment').textContent = `Customizable select: ${enhanced}; ResizeObserver: ${typeof ResizeObserver !== 'undefined'}. ${navigator.userAgent}`;

function createGroup(frame: HTMLElement, status: HTMLElement, options: readonly NativeOption[], label: string, overflowAt?: number): GroupFixture {
  const group = document.createElement('music-toggle-button-group');
  group.options = options;
  group.label = label;
  group.overflowAt = overflowAt;
  group.value = options[0]?.value ?? '';
  frame.append(group);
  return { group, frame, status };
}

function createCase(label: string, options: readonly NativeOption[], overflowAt?: number): GroupFixture {
  const article = document.createElement('article');
  const heading = document.createElement('h2');
  heading.textContent = label;
  const viewport = document.createElement('div');
  viewport.className = 'width-viewport';
  const frame = document.createElement('div');
  frame.className = 'group-frame';
  const status = document.createElement('pre');
  status.className = 'case-status';
  viewport.append(frame);
  article.append(heading, viewport, status);
  query('#cases').append(article);
  return createGroup(frame, status, options, label, overflowAt);
}

const demo = createGroup(query('#demo-frame'), query('#demo-state'), ENTRY_DURATION_OPTIONS, 'Duration', 4);
demo.group.id = 'duration-group';
demo.group.value = 'quarter';

const boundaryCases = [
  { label: 'Accidentals · overflow at 3', options: ENTRY_ACCIDENTAL_OPTIONS, limit: 3 },
  { label: 'Duration · overflow at 4', options: ENTRY_DURATION_OPTIONS, limit: 4 },
  { label: 'Dots · overflow at 1', options: ENTRY_DOTS_OPTIONS, limit: 1 },
  { label: 'Attack · overflow at 2', options: ENTRY_ATTACK_OPTIONS, limit: 2 },
].map(config => ({ ...config, fixture: createCase(config.label, config.options, config.limit) }));

const fractionalOptions = ENTRY_DURATION_OPTIONS.slice(0, 4).map((option, index) => ({ ...option, label: String.fromCharCode(65 + index) }));
const fractional = createCase('Fractional controls · 44.25px buttons, 1.25px gaps', fractionalOptions);
fractional.group.style.setProperty('--music-toggle-button-size', '44.25px');
fractional.group.style.setProperty('--music-toggle-gap', '1.25px');

const padded = createCase('Padded parent · border-box and content-box sizing', fractionalOptions);
padded.group.style.setProperty('--music-toggle-button-size', '44.25px');
padded.group.style.setProperty('--music-toggle-gap', '1.25px');
padded.frame.style.padding = '7px 11px';
padded.frame.style.border = '3px solid transparent';

const manyOptions = Array.from({ length: 40 }, (_, index) => ({
  ...ENTRY_DURATION_OPTIONS[index % ENTRY_DURATION_OPTIONS.length], value: `option-${index}`, label: String(index + 1),
}));
const unlimited = createCase('Uncapped group · 40 options', manyOptions);

const sharedArticle = document.createElement('article');
const sharedHeading = document.createElement('h2');
sharedHeading.textContent = 'Shared row · groups reclaim available space';
const sharedViewport = document.createElement('div');
sharedViewport.className = 'width-viewport';
const sharedRow = document.createElement('div');
sharedRow.className = 'group-frame';
sharedRow.dataset.toggleGroupRow = '';
sharedRow.style.cssText = 'display: flex; align-items: center; gap: 6px; width: 210px;';
sharedViewport.append(sharedRow);
sharedArticle.append(sharedHeading, sharedViewport);
query('#cases').append(sharedArticle);
const sharedCases = boundaryCases.map(({ label, options, limit }) => {
  const status = document.createElement('pre');
  status.className = 'case-status';
  sharedArticle.append(status);
  return { limit, fixture: createGroup(sharedRow, status, options, label, limit) };
});

// These baselines use native DOM only, without Lit or application event handlers.
const ordinary = query<HTMLSelectElement>('#ordinary-select');
const customizable = query<HTMLSelectElement>('#customizable-select');
const nativeButton = document.createElement('button');
nativeButton.type = 'button';
nativeButton.append(document.createElement('selectedcontent'));
customizable.append(nativeButton);
for (const select of [ordinary, customizable]) {
  for (const option of ENTRY_DURATION_OPTIONS) select.append(new Option(option.label, option.value));
  select.value = 'quarter';
}

type InteractionKind = 'group' | 'ordinary' | 'customizable';
const interactions: Record<InteractionKind, { click: string; keydown: string }> = {
  group: { click: 'none', keydown: 'none' },
  ordinary: { click: 'none', keydown: 'none' },
  customizable: { click: 'none', keydown: 'none' },
};

function openState(select: HTMLSelectElement | null): string {
  if (!select) return 'no overflow';
  try { return String(select.matches(':open')); } catch { return ':open unsupported'; }
}

function interactionStatus(): void {
  query('#interaction-status').textContent = [
    ...Object.entries(interactions).map(([kind, events]) => `${kind}\n  last click: ${events.click}\n  last keydown: ${events.keydown}`),
    `Picker :open — group: ${openState(demo.group.shadowRoot!.querySelector('select'))}; ordinary: ${openState(ordinary)}; customizable: ${openState(customizable)}`,
    `Document focused: ${document.hasFocus()}; visibility: ${document.visibilityState}`,
  ].join('\n');
}

for (const type of ['click', 'keydown'] as const) {
  document.addEventListener(type, event => {
    const path = event.composedPath();
    const kind: InteractionKind | undefined = path.includes(demo.group) ? 'group'
      : path.includes(ordinary) ? 'ordinary' : path.includes(customizable) ? 'customizable' : undefined;
    if (!kind) return;
    const target = path[0];
    const targetName = target instanceof Element ? `${target.tagName.toLowerCase()}${target.id ? `#${target.id}` : ''}` : String(target);
    const activation = navigator.userActivation?.isActive ?? false;
    // Read defaultPrevented after every handler had a chance to observe the
    // event. This diagnostic never calls preventDefault or showPicker.
    queueMicrotask(() => {
      interactions[kind][type] = `isTrusted=${event.isTrusted}, defaultPrevented=${event.defaultPrevented}, target=${targetName}${event instanceof KeyboardEvent ? `, key=${event.key}` : ''}, userActivation=${activation}`;
      interactionStatus();
    });
  }, { capture: true });
}

const directButtons = (group: MusicToggleButtonGroup): HTMLButtonElement[] => [...group.shadowRoot!.querySelectorAll<HTMLButtonElement>('.controls > button')];
const overflowSelect = (group: MusicToggleButtonGroup): HTMLSelectElement | null => group.shadowRoot!.querySelector('select');
const overflowValues = (group: MusicToggleButtonGroup): string[] => [...(overflowSelect(group)?.options ?? [])].filter(option => !option.hidden).map(option => option.value);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertSingleSelection(group: MusicToggleButtonGroup, expected = group.value): void {
  assert(group.value === expected, `Expected value ${expected}; received ${group.value}.`);
  assert(group.options.filter(option => option.value === group.value).length === 1, 'The group must hold exactly one valid option value.');
  const pressed = directButtons(group).filter(button => button.getAttribute('aria-pressed') === 'true');
  const select = overflowSelect(group);
  const selectedInOverflow = select?.dataset.selected === 'true';
  assert(pressed.length + Number(selectedInOverflow) === 1, 'Exactly one direct button or overflow selection must be marked active.');
  if (selectedInOverflow) assert(select.value === expected, 'Native overflow selection must match the group value.');
}

function assertOrder(group: MusicToggleButtonGroup): void {
  const values = [...directButtons(group).map(button => button.value), ...overflowValues(group)];
  assert(values.join('|') === group.options.map(option => option.value).join('|'), 'Every option must appear once, in its authored order.');
}

function assertContained(group: MusicToggleButtonGroup): void {
  const controls = group.shadowRoot!.querySelector<HTMLElement>('.controls')!;
  const bounds = controls.getBoundingClientRect();
  const style = getComputedStyle(controls);
  const padding = { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight), top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) };
  const children = [...controls.children].map(child => child.getBoundingClientRect());
  for (const rect of children) {
    assert(rect.left >= bounds.left + padding.left - 0.02 && rect.right <= bounds.right - padding.right + 0.02
      && rect.top >= bounds.top + padding.top - 0.02 && rect.bottom <= bounds.bottom - padding.bottom + 0.02,
      `Control must remain inside the ${bounds.width.toFixed(3)}px container's padded content box.`);
    assert(rect.width >= 44 && rect.height >= 44, 'Tray padding must not reduce a control below its 44px target.');
  }
  const visibleWidth = children.length
    ? Math.max(...children.map(rect => rect.right)) - Math.min(...children.map(rect => rect.left)) : 0;
  const fittedWidth = visibleWidth + padding.left + padding.right;
  assert(Math.abs(bounds.width - fittedWidth) <= 0.05,
    `The ${bounds.width.toFixed(3)}px group surface must fit its visible controls plus ${padding.left + padding.right}px tray padding without unused space.`);
  const hostWidth = group.getBoundingClientRect().width;
  assert(Math.abs(hostWidth - fittedWidth) <= 0.05,
    `The ${hostWidth.toFixed(3)}px group host must fit its ${fittedWidth.toFixed(3)}px padded visible controls.`);
}

function visibleOverflowIcon(group: MusicToggleButtonGroup): string | null {
  const button = group.shadowRoot!.querySelector<HTMLElement>('.overflow > button');
  const face = button && getComputedStyle(button).display !== 'none' ? button : group.shadowRoot!.querySelector('.overflow-face');
  return face?.querySelector(':scope > svg')?.getAttribute('data-icon') ?? null;
}

function describe(fixture: GroupFixture): void {
  const buttons = directButtons(fixture.group);
  fixture.status.textContent = `Container: ${fixture.frame.getBoundingClientRect().width.toFixed(3)}px; direct: ${buttons.length}; overflow: ${overflowValues(fixture.group).length}; selected: ${fixture.group.value}\nDirect values: ${buttons.map(button => button.value).join(', ') || '(none)'}\nOverflow face icon: ${visibleOverflowIcon(fixture.group) ?? '(no overflow)'}`;
}

async function settle(fixture: GroupFixture): Promise<void> {
  await fixture.group.updateComplete;
  // ResizeObserver runs after layout and the component measures on a later
  // animation frame. Wait for those real browser phases without mocking sizes.
  for (let frame = 0; frame < 4; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await fixture.group.updateComplete;
  describe(fixture);
}

async function resize(fixture: GroupFixture, width: number): Promise<void> {
  fixture.frame.style.width = `${width}px`;
  await settle(fixture);
}

async function settleSharedRow(): Promise<void> {
  await Promise.all(sharedCases.map(({ fixture }) => settle(fixture)));
}

async function resizeSharedRow(width: number): Promise<void> {
  sharedRow.style.width = `${width}px`;
  await settleSharedRow();
}

function widthForCount(group: MusicToggleButtonGroup, count: number): number {
  const measurements = group.shadowRoot!.querySelector('.measurements')!;
  const widths = [...measurements.querySelectorAll('[data-measure-option]')]
    .slice(0, count).map(element => element.getBoundingClientRect().width);
  const hasOverflow = count < group.options.length;
  if (hasOverflow) widths.push(measurements.querySelector('.overflow-measurement')!.getBoundingClientRect().width);
  const gap = parseFloat(getComputedStyle(measurements).columnGap);
  const trayStyle = getComputedStyle(group.shadowRoot!.querySelector('.controls')!);
  return widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1)
    + parseFloat(trayStyle.paddingLeft) + parseFloat(trayStyle.paddingRight);
}

function sharedWidthForCaps(): number {
  const gap = parseFloat(getComputedStyle(sharedRow).columnGap);
  return sharedCases.reduce((sum, { fixture, limit }) => sum + widthForCount(fixture.group, limit), 0)
    + gap * (sharedCases.length - 1);
}

function sharedCounts(): string {
  return sharedCases.map(({ fixture }) => directButtons(fixture.group).length).join('/');
}

function assertSharedLayout(): void {
  const bounds = sharedRow.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(sharedRow).columnGap);
  let previous: DOMRect | undefined;
  let used = gap * (sharedCases.length - 1);
  for (const { fixture } of sharedCases) {
    assertContained(fixture.group);
    const rect = fixture.group.getBoundingClientRect();
    assert(rect.left >= bounds.left - 0.05 && rect.right <= bounds.right + 0.05,
      `${fixture.group.label} must remain inside the shared row.`);
    if (previous) assert(Math.abs(rect.left - previous.right - gap) <= 0.05,
      `Adjacent group surfaces must stay ${gap}px apart, without unused allocation gaps.`);
    used += rect.width;
    previous = rect;
  }
  const spare = bounds.width - used;
  for (const { fixture, limit } of sharedCases) {
    const count = directButtons(fixture.group).length;
    assert(count <= limit, `${fixture.group.label} must respect its overflow boundary.`);
    if (count === limit) continue;
    const growth = widthForCount(fixture.group, count + 1) - fixture.group.getBoundingClientRect().width;
    assert(growth > spare + 0.05,
      `${fixture.group.label} can reveal another choice using ${growth.toFixed(3)}px, but the row leaves ${spare.toFixed(3)}px unused.`);
  }
}

let running = false;

async function runChecks(): Promise<void> {
  if (running) return;
  running = true;
  runButton.disabled = true;
  widthInput.disabled = true;
  outcomes.replaceChildren();
  summary.dataset.state = 'running';
  summary.textContent = 'Running real layout and DOM checks…';
  let passed = 0;
  let failed = 0;
  const check = async (name: string, action: () => Promise<string>): Promise<void> => {
    const item = document.createElement('li');
    outcomes.append(item);
    try {
      item.textContent = `PASS — ${name}: ${await action()}`;
      item.dataset.result = 'pass';
      passed++;
    } catch (error) {
      item.textContent = `FAIL — ${name}: ${error instanceof Error ? error.message : String(error)}`;
      item.dataset.result = 'fail';
      failed++;
    }
  };

  try {
    for (const { label, options, limit, fixture } of boundaryCases) {
      await check(label, async () => {
        await resize(fixture, 640);
        assert(directButtons(fixture.group).length === limit, `Expected ${limit} direct buttons at 640px.`);
        assert(overflowValues(fixture.group).length === options.length - limit, 'The overflow boundary must apply even with spare space.');
        assertOrder(fixture.group);
        assertSingleSelection(fixture.group);
        assertContained(fixture.group);
        return `${limit} direct, ${options.length - limit} overflow; all ${options.length} values retain their order.`;
      });
    }

    await check('Repeated container resize: wide → partial → tiny → wide', async () => {
      demo.group.value = 'quarter';
      await resize(demo, 640);
      const wide = directButtons(demo.group).map(button => button.value).join('|');
      assert(wide === 'half|quarter|eighth|sixteenth', 'Wide duration group must prioritize Half, Quarter, Eighth, and Sixteenth.');
      assert(overflowValues(demo.group).includes('whole'), 'Whole must remain in overflow even when all four direct durations fit.');
      assert(visibleOverflowIcon(demo.group) === phDotsThree.name, 'Partial overflow must use the default dots icon.');
      assertContained(demo.group);
      for (let cycle = 0; cycle < 2; cycle++) {
        await resize(demo, 130);
        assert(directButtons(demo.group).map(button => button.value).join('|') === 'half', 'A 130px container must show Half and the overflow picker.');
        assert(visibleOverflowIcon(demo.group) === phDotsThree.name, 'A partially collapsed group must retain the default overflow icon.');
        assertOrder(demo.group);
        assertSingleSelection(demo.group, 'quarter');
        assertContained(demo.group);
        await resize(demo, 48);
        assert(directButtons(demo.group).length === 0, 'A 48px container must keep a 44px overflow control inside its padded tray.');
        assert(overflowValues(demo.group).length === ENTRY_DURATION_OPTIONS.length, 'Every duration must remain in the native picker.');
        assert(visibleOverflowIcon(demo.group) === ENTRY_DURATION_OPTIONS[0].icon!.name, 'The visible collapsed face must use the first duration icon.');
        assertSingleSelection(demo.group, 'quarter');
        assertContained(demo.group);
        await resize(demo, 640);
        assert(directButtons(demo.group).map(button => button.value).join('|') === wide, 'Growing the same container must restore the original direct choices.');
        assertSingleSelection(demo.group, 'quarter');
        assertContained(demo.group);
      }
      return '4 → 1 → 0 → 4 direct buttons twice; host and surface always fit the padded visible controls; Quarter remains selected.';
    });

    await check('Shared row restores choices and reuses space between fitted groups', async () => {
      await resizeSharedRow(210);
      assert(sharedCounts() === '0/0/0/0', 'The minimum row must start with four overflow controls.');
      assertSharedLayout();
      const fullWidth = sharedWidthForCaps();
      await resizeSharedRow(fullWidth);
      assert(sharedCounts() === '3/4/1/2', 'The exact combined capped width must restore every configured direct choice.');
      assertSharedLayout();
      await resizeSharedRow(fullWidth + 160);
      assert(sharedCounts() === '3/4/1/2', 'Extra row space must not expand groups past their overflow boundaries.');
      assertSharedLayout();
      const outcomes: string[] = [];
      for (const fraction of [0.2, 0.45, 0.7]) {
        const width = 210 + (fullWidth - 210) * fraction;
        await resizeSharedRow(width);
        assertSharedLayout();
        const counts = sharedCounts();
        await resizeSharedRow(210);
        assert(sharedCounts() === '0/0/0/0', 'Shrinking the shared row must collapse every group again.');
        await resizeSharedRow(width);
        assert(sharedCounts() === counts, 'Returning to the same width must restore the same choices without a sizing loop.');
        assertSharedLayout();
        outcomes.push(`${width.toFixed(2)}px: ${counts}`);
      }
      await resizeSharedRow(fullWidth);
      assert(sharedCounts() === '3/4/1/2', 'Growing the shared row must restore all four capped prefixes after repeated collapse.');
      assertSharedLayout();
      return `Four padded 44px overflow controls grow to 3/4/1/2 at ${fullWidth.toFixed(3)}px; ${outcomes.join('; ')}. Surfaces fit their controls and tray padding, gaps stay 6px, and no additional choice fits unused space.`;
    });

    await check('Shared row recalculates after inherited label size changes', async () => {
      const fullWidth = sharedWidthForCaps();
      await resizeSharedRow(fullWidth);
      assert(sharedCounts() === '3/4/1/2', 'Normal labels must initially fit all capped prefixes.');
      try {
        sharedRow.style.setProperty('--music-toggle-label-size', '0.9rem');
        await settleSharedRow();
        assert(sharedWidthForCaps() > fullWidth, 'Larger labels must increase the measured space required by the row.');
        assert(sharedCounts() !== '3/4/1/2', 'Larger labels must collapse choices when the row width remains unchanged.');
        assertSharedLayout();
      } finally {
        sharedRow.style.removeProperty('--music-toggle-label-size');
        await settleSharedRow();
      }
      assert(sharedCounts() === '3/4/1/2', 'Restoring label size must reveal the same original choices without a viewport resize.');
      assertSharedLayout();
      return 'Inherited label growth repacks the same row; restoring the label size restores 3/4/1/2 without changing its width.';
    });

    await check('Single selection and one event pair per change', async () => {
      await resize(demo, 640);
      demo.group.value = 'half';
      await settle(demo);
      let inputs = 0;
      let changes = 0;
      const onInput = (): void => { inputs++; };
      const onChange = (): void => { changes++; };
      demo.group.addEventListener('input', onInput);
      demo.group.addEventListener('change', onChange);
      try {
        const quarter = directButtons(demo.group).find(button => button.value === 'quarter')!;
        quarter.click();
        await settle(demo);
        assertSingleSelection(demo.group, 'quarter');
        quarter.click();
        await settle(demo);
        assertSingleSelection(demo.group, 'quarter');
        assert(inputs === 1 && changes === 1, 'Clicking the selected button again must preserve selection without another event pair.');
        const select = overflowSelect(demo.group)!;
        select.value = 'whole';
        select.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        select.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        await settle(demo);
        assertSingleSelection(demo.group, 'whole');
        assert(!directButtons(demo.group).some(button => button.value === 'whole'), 'Selecting Whole must keep it in overflow.');
        assert(Number(inputs) === 2 && Number(changes) === 2, 'Native input/change must produce one group event pair, not two.');
        assertOrder(demo.group);
        return 'Direct selection, repeat click, and native overflow selection preserve one active value; two changes emit two input/change pairs (synthetic events).';
      } finally {
        demo.group.removeEventListener('input', onInput);
        demo.group.removeEventListener('change', onChange);
      }
    });

    await check('Fractional dimensions at an exact fit boundary', async () => {
      await resize(fractional, 250);
      assert(directButtons(fractional.group).length === fractionalOptions.length, 'All four fractional-width controls must fit at 250px.');
      const required = widthForCount(fractional.group, fractionalOptions.length);
      assert(Math.abs(required - Math.round(required)) > 0.1, `Expected fractional total width; received ${required}.`);
      await resize(fractional, required - 0.25);
      assert(directButtons(fractional.group).length < fractionalOptions.length, 'A container below the actual required width must collapse options.');
      assertContained(fractional.group);
      assertOrder(fractional.group);
      assertSingleSelection(fractional.group);
      await resize(fractional, required);
      assert(directButtons(fractional.group).length === fractionalOptions.length, 'All controls must return at the exact fractional fit.');
      assertContained(fractional.group);
      return `${required.toFixed(3)}px of padded controls collapse at ${(required - 0.25).toFixed(3)}px and fit again at the exact ${required.toFixed(3)}px boundary.`;
    });

    await check('Available width excludes parent padding and border', async () => {
      padded.frame.style.boxSizing = 'border-box';
      await resize(padded, 250);
      assert(directButtons(padded.group).length === fractionalOptions.length, 'The padded parent must initially fit all four choices.');
      const required = widthForCount(padded.group, fractionalOptions.length);
      const parentStyle = getComputedStyle(padded.frame);
      const insets = parseFloat(parentStyle.paddingLeft) + parseFloat(parentStyle.paddingRight)
        + parseFloat(parentStyle.borderLeftWidth) + parseFloat(parentStyle.borderRightWidth);
      for (const boxSizing of ['border-box', 'content-box']) {
        padded.frame.style.boxSizing = boxSizing;
        const outerAdjustment = boxSizing === 'border-box' ? insets : 0;
        await resize(padded, required + outerAdjustment - 0.25);
        assert(directButtons(padded.group).length < fractionalOptions.length,
          `${boxSizing} sizing must collapse choices when the parent content box is too small.`);
        assertContained(padded.group);
        await resize(padded, required + outerAdjustment);
        assert(directButtons(padded.group).length === fractionalOptions.length,
          `${boxSizing} sizing must restore all choices at the exact content-box fit.`);
        assertContained(padded.group);
      }
      return `Both parent box models use the ${required.toFixed(3)}px content width; ${insets}px of padding and border never count as available space.`;
    });

    await check('Uncapped group with many options', async () => {
      await resize(unlimited, 2000);
      assert(directButtons(unlimited.group).length === manyOptions.length, 'An uncapped group must show all 40 choices when they fit.');
      assert(overflowSelect(unlimited.group) === null, 'A fully visible group must not retain an empty overflow picker.');
      await resize(unlimited, 200);
      assert(directButtons(unlimited.group).length < manyOptions.length, 'An uncapped group must still collapse to its available width.');
      assertOrder(unlimited.group);
      assertContained(unlimited.group);
      assertSingleSelection(unlimited.group);
      return `All 40 choices fit at 2000px; ${directButtons(unlimited.group).length} remain direct at 200px; no options disappear.`;
    });
  } finally {
    await resize(demo, Number(widthInput.value) || 480);
    summary.dataset.state = 'complete';
    summary.dataset.result = failed ? 'fail' : 'pass';
    summary.textContent = `${passed} passed; ${failed} failed. Native picker opening remains a manual check.`;
    runButton.disabled = false;
    widthInput.disabled = false;
    running = false;
    interactionStatus();
  }
}

widthInput.addEventListener('input', () => {
  if (!widthInput.validity.valid || !Number.isFinite(widthInput.valueAsNumber)) return;
  void resize(demo, widthInput.valueAsNumber);
});
demo.group.addEventListener('change', () => { void settle(demo); });
for (const select of [ordinary, customizable]) select.addEventListener('change', interactionStatus);
runButton.addEventListener('click', () => { void runChecks(); });
void runChecks();
