import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import * as engines from 'playwright';

// The existing fixture keeps its score and recovery in memory, away from user data.
const base = process.env.WRITING_TEST_URL || 'http://127.0.0.1:5173';
const engine = process.env.WRITING_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'firefox', 'webkit'].includes(engine));
const output = resolve(process.env.WRITING_TEST_OUTPUT || `/tmp/music-notes-writing-recovery-${engine}`);
await mkdir(output, { recursive: true });
const browser = await engines[engine].launch({ headless: true });
try {
  const viewport = { width: Number(process.env.WRITING_TEST_WIDTH || 1280), height: Number(process.env.WRITING_TEST_HEIGHT || 900) };
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/tests/authoring-listen-browser.html`);
  const ready = () => page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
  await ready();
  const score = page.locator('music-staff#trombone-study');
  const music = () => score.evaluate(el => el.innerHTML);
  const writing = async expected => assert.equal(await page.locator('#toggle-entry').getAttribute('aria-pressed'), String(expected));
  const panel = page.locator('#location-panel');
  const start = page.locator('#start-entry-here');
  const focusedStart = async () => assert.equal(await start.evaluate(el => el.matches(':focus')), true);
  await page.locator('#score-host .screen g.vf-music-event[data-source-id="trombone-m1-n1"]').click();
  await page.locator('#toggle-entry').click();
  await writing(true);
  await page.locator('#select-mode').click();
  // Applying Source removes the parked writer while keeping another note selected.
  const edited = await score.evaluate(el => {
    const copy = el.cloneNode(true);
    copy.querySelector('#trombone-m1-n1').remove();
    copy.querySelector('#trombone-m1').setAttribute('incomplete', '');
    return copy.outerHTML;
  });
  await page.locator('#source-trigger').click();
  await page.locator('#source-input').fill(edited);
  await page.locator('#source-apply').click();
  assert.equal(await page.locator('#source-error').isVisible(), false);
  await page.locator('#close-source').click();
  await ready();
  await page.locator('#score-host .screen g.vf-music-event[data-source-id="trombone-m1-n2"]').click();
  const before = await music();
  await page.locator('#toggle-entry').click();
  await panel.waitFor({ state: 'visible' });
  await writing(false);
  await focusedStart();
  assert.equal(await page.locator('#author-errors').isVisible(), false);
  assert.match(await page.locator('#entry-mode-reason').textContent(), /removed or changed/);
  assert.equal(await music(), before);
  await page.screenshot({ path: `${output}/choose-location.png` });

  // Escape and a second attempt remain recoverable; neither changes the score.
  await start.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  await page.locator('#toggle-entry').click();
  await panel.waitFor({ state: 'visible' });
  await focusedStart();
  assert.equal(await music(), before);
  await start.click();
  await writing(true);
  await panel.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#score-editor').evaluate(el => el.matches(':focus')), true);
  assert.equal(await music(), before);
  await page.locator('#select-mode').click();
  await page.locator('#toggle-entry').click();
  await writing(true);
  assert.equal(await panel.isVisible(), false);
  await page.locator('#score-editor').press('Enter');
  await ready();
  assert.equal(await score.locator('music-note').count(), 14);
  assert.equal(await score.locator('#trombone-m1 music-note').count(), 3);
  assert.notEqual(await music(), before);
  assert.equal(await page.locator('#author-errors').isVisible(), false);
  await page.screenshot({ path: `${output}/writing-restored.png` });
  assert.deepEqual(errors, []);
  const result = { browser: engine, version: browser.version(), viewport, checks: ['removed writer opens chooser', 'Start writing here receives focus', 'dismiss and retry', 'recovery preserves score', 'Select/Write roundtrip', 'Enter inserts in chosen measure'], errors };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
