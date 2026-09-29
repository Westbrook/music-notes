import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.CLIPBOARD_TEST_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.CLIPBOARD_TEST_OUTPUT || '/tmp/music-notes-clipboard');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/tests/authoring-listen-browser.html`);
  const ready = () => page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
  await ready();
  const fixture = `<music-staff id="staff"><music-measure id="from"><music-note id="a" pitch="C4" duration="half"><music-articulation id="mark" type="accent"></music-articulation></music-note><music-note id="b" pitch="D4" duration="quarter"></music-note><music-note id="c" pitch="E4" duration="quarter"></music-note></music-measure><music-measure id="to" incomplete end-bar="final"><music-note id="d" pitch="F4" duration="half" dots="1"></music-note></music-measure></music-staff>`;
  await page.locator('#source-trigger').click(); await page.locator('#source-input').fill(fixture);
  await page.locator('#source-apply').click(); await page.locator('#close-source').click(); await ready();
  const source = page.locator('music-staff#staff');
  const html = () => source.evaluate(el => el.outerHTML);
  const before = await html();
  const note = id => page.locator(`#score-host .screen g.vf-music-event[data-source-id="${id}"]`);
  await note('a').click(); await note('b').click({ modifiers: ['Shift'] });
  await page.keyboard.press('ControlOrMeta+c');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(copied.startsWith('Music Notes passage v1\n'));
  assert.equal(await html(), before);
  // Selection changes after copy must not change the clipboard snapshot.
  await note('d').click(); await page.locator('#toggle-entry').click();
  await page.keyboard.press('ControlOrMeta+v'); await ready();
  await source.locator('music-note').nth(6).waitFor({ state: 'attached' });
  const afterPaste = await html();
  assert.equal(await source.locator('music-measure').count(), 3);
  assert.deepEqual(await source.locator('music-note').evaluateAll(nodes => nodes.map(node => node.getAttribute('pitch'))), ['C4', 'D4', 'E4', 'F4', 'C4', 'C4', 'D4']);
  assert.equal(await source.locator('music-articulation').count(), 2);
  assert.equal(await page.locator('#toggle-entry').getAttribute('aria-pressed'), 'true');
  await page.screenshot({ path: `${output}/pasted.png` });
  await page.keyboard.press('ControlOrMeta+z'); await ready(); assert.equal(await html(), before);
  await page.keyboard.press('ControlOrMeta+Shift+z'); await ready(); assert.equal(await html(), afterPaste);
  // Ordinary keyboard entry now flows as well, including through the final barline.
  for (let i = 0; i < 8; i++) { await page.locator('#score-editor').press('Enter'); await ready(); }
  assert.ok(await source.locator('music-measure').count() > 3);
  assert.equal(await source.locator('music-note').count(), 15);
  assert.equal(await page.locator('#author-errors').isVisible(), false);
  // A real pointer insertion in the already-full first bar must flow as well.
  const beforePointer = await html();
  await note('c').click(); await ready();
  assert.equal(await source.locator('music-note').count(), 16);
  assert.equal(await source.locator('#a, #b, #c, #d').count(), 4);
  await page.keyboard.press('ControlOrMeta+z'); await ready();
  assert.equal(await html(), beforePointer);
  await page.screenshot({ path: `${output}/continued.png` });
  // Native text paste retains the original payload instead of inserting more notes.
  const musicBeforeText = await html();
  await page.locator('#source-trigger').click(); await page.locator('#source-input').focus();
  await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('ControlOrMeta+v');
  assert.equal(await page.locator('#source-input').inputValue(), copied);
  assert.equal(await html(), musicBeforeText);
  assert.deepEqual(errors, []);
  const result = { browser: browser.version(), passed: true, checks: ['native Command/Ctrl+C and V', 'score order and clipboard snapshot', 'marks retained once across tied splits', 'cursor stays in Write notes', 'one-step undo and redo', 'keyboard and pointer entry flow across bars', 'text paste stays native'], errors };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
