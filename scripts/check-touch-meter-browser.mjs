import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
const engine = process.env.TOUCH_TEST_BROWSER || 'chromium';
const browser = await ({ chromium, webkit })[engine].launch({ headless: true });
const base = process.env.TOUCH_TEST_URL || 'http://127.0.0.1:5173';
const output = process.env.TOUCH_TEST_OUTPUT || `/tmp/music-notes-touch-meter-${engine}`;
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}/tests/authoring-listen-browser.html`);
  const ready = () => page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
  await ready();
  await page.locator('#source-trigger').tap();
  const notes = ['a', 'b', 'c', 'd'].map(id => `<music-note id="${id}" pitch="C4" duration="quarter"></music-note>`).join('');
  await page.locator('#source-input').fill(`<music-staff id="staff"><music-measure id="bar">${notes}</music-measure></music-staff>`);
  await page.locator('#source-apply').tap(); await page.locator('#close-source').tap(); await ready();
  const source = page.locator('music-staff#staff');
  const html = () => source.evaluate(el => el.outerHTML);
  const before = await html();
  const note = id => page.locator(`#score-host .screen g.vf-music-event[data-source-id="${id}"]`);
  const ids = async () => JSON.parse(await page.locator('#selection-controls').getAttribute('data-event-ids'));
  await note('a').tap();
  const checkActionRow = async collecting => {
    for (const width of [320, 390, 844, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const buttons = collecting
        ? ['selection-shared', 'selection-relationships', 'selection-select-more', 'selection-range', 'selection-done']
        : ['selection-pitch', 'selection-value', 'selection-attached-marks', 'selection-select-more'];
      const boxes = await Promise.all(buttons.map(id => page.locator(`#${id}`).boundingBox()));
      const singleRow = !collecting || width >= 390;
      if (singleRow) assert.ok(boxes.every(box => box && Math.abs(box.y - boxes[0].y) < 1), `${width}px: selection actions share a row`);
      for (let i = 1; i < boxes.length; i++) {
        assert.ok(boxes[i].y >= boxes[i - 1].y + boxes[i - 1].height - 1 || boxes[i].x >= boxes[i - 1].x + boxes[i - 1].width - 1, `${width}px: actions do not overlap`);
      }
      assert.ok(boxes.every(box => box.x >= 0 && box.x + box.width <= width), `${width}px: actions fit the viewport`);
      if (singleRow) {
        const height = (await page.locator('#workspace-dock').boundingBox()).height;
        await page.locator('#selection-collection').evaluate(el => { el.style.display = 'none'; });
        assert.equal((await page.locator('#workspace-dock').boundingBox()).height, height, `${width}px: collection actions add no toolbar height`);
        await page.locator('#selection-collection').evaluate(el => { el.style.removeProperty('display'); });
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no horizontal page overflow`);
      await page.screenshot({ path: `${output}/action-row-${width}-${collecting ? 'collecting' : 'single'}.png` });
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.screenshot({ path: `${output}/action-row-large-text-${collecting ? 'collecting' : 'single'}.png` });
    for (const id of ['selection-select-more', ...(collecting ? ['selection-range', 'selection-done'] : ['selection-pitch', 'selection-value', 'selection-attached-marks'])]) {
      const box = await page.locator(`#${id}`).boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 320 && box.height >= 44, `large text: ${id} remains inside the viewport with a full touch target`);
    }
    await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
    await page.setViewportSize({ width: 390, height: 844 });
  };
  await checkActionRow(false);
  await page.locator('#selection-select-more').tap();
  assert.equal(await page.locator('#selection-select-more').getAttribute('aria-pressed'), 'true');
  await checkActionRow(true);
  await note('c').tap(); assert.deepEqual(await ids(), ['a', 'c']);
  await note('c').tap(); assert.deepEqual(await ids(), ['a']);
  await note('b').tap(); await note('c').tap(); assert.deepEqual(await ids(), ['a', 'b', 'c']);
  assert.equal(await html(), before);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${output}/touch-selection.png` });
  await page.locator('#selection-done').tap(); assert.deepEqual(await ids(), ['a', 'b', 'c']);
  await page.locator('#selection-relationships').tap();
  await page.locator('#wrap-tuplet').tap(); await ready();
  assert.equal(await source.locator('music-tuplet music-note').count(), 3);
  await page.locator('#undo').tap(); await ready(); assert.equal(await html(), before);
  // Range is accessible without a modifier key; the existing native endpoint selectors own it.
  await page.locator('#tools-hide').tap();
  await page.locator('#selection-select-more').tap();
  await page.locator('#selection-range').tap();
  await page.locator('#range-start').selectOption('a'); await page.locator('#range-end').selectOption('d');
  assert.deepEqual(await ids(), ['a', 'b', 'c', 'd']);
  await page.locator('#tool-tab-measure').tap();
  await page.locator('#measure-meter').fill('3/4');
  // Commit the native field edit before scrolling down to Apply (mobile keyboard dismissal).
  await page.locator('#measure-inspector .panel-heading').tap();
  await page.locator('#apply-measure').tap();
  try { await source.locator('music-measure').nth(1).waitFor({ state: 'attached', timeout: 5000 }); } catch (error) {
    await page.screenshot({ path: `${output}/meter-failure.png` });
    console.log(await page.locator('#measure-meter').inputValue(), await page.locator('#measure-draft-status').textContent(), await page.locator('#author-errors').textContent(), await html()); throw error;
  } await ready();
  assert.equal(await source.locator('music-measure').count(), 2);
  const bars = await source.locator('music-measure').evaluateAll(nodes => nodes.map(n => ({ meter: n.getAttribute('meter'), ids: [...n.querySelectorAll('music-note')].map(e => e.id), incomplete: n.hasAttribute('incomplete') })));
  assert.deepEqual(bars.map(b => [b.meter, b.ids]), [['3/4', ['a', 'b', 'c']], ['3/4', ['d']]]);
  assert.equal(bars[1].incomplete, true);
  await page.locator('#tools-hide').tap();
  await page.screenshot({ path: `${output}/meter-overflow.png` });
  await page.locator('#undo').tap(); await ready(); assert.equal(await html(), before);
  assert.deepEqual(errors, []);
  const result = { passed: true, engine, version: browser.version(), checks: ['320/390/844/1440px action-row alignment and toolbar height', '320px enlarged-text controls', '390px browser touch taps', 'direct multi-selection with toggling', 'selection adds no music history', 'triplet from touch selection and Undo', 'native range selectors', '4/4 to 3/4 overflow through real form', 'overflow Undo', 'no browser errors'], limitations: ['Emulated browser touch input; physical iPhone/iPad gestures not tested.', 'Expanded collection actions may wrap at 320px or with enlarged text.'] };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
