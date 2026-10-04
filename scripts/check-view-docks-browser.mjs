import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DOCK_TEST_URL || 'http://127.0.0.1:5173';
const output = process.env.DOCK_TEST_OUTPUT || '/tmp/music-notes-view-docks';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // This existing fixture uses memory-only recovery; no user composition is touched.
  await page.goto(`${base}/tests/authoring-listen-browser.html`);
  await page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
  const bounds = [];
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const mode of ['read', 'pages']) {
      // Native keyboard activation also covers the existing crowded 320px header.
      await page.locator(`#view-${mode}`).press('Enter');
      await page.waitForSelector('body[data-render-state="ready"]');
      if (mode === 'pages') await page.locator('#page-host .score-page').first().waitFor();
      const dock = page.locator(`#${mode}-tools`);
      const area = page.locator(mode === 'read' ? '#score-editor' : '#page-host');
      const d = await dock.boundingBox(), a = await area.boundingBox();
      const workspace = await page.locator('.author-workspace').boundingBox();
      assert.equal(d.x, 0);
      assert.equal(d.width, viewport.width);
      assert.ok(Math.abs(d.y + d.height - workspace.y - workspace.height) <= 3, `${mode}: bottom alignment`);
      assert.ok(a.y + a.height <= d.y + 1, `${mode}: preview and dock do not overlap`);
      assert.equal(await dock.evaluate(el => el.scrollWidth > el.clientWidth), false);
      if (viewport.width === 1280) assert.ok(d.height <= 75, `${mode}: compact desktop dock`);
      bounds.push({ mode, viewport, dock: d });
      await page.screenshot({ path: `${output}/${mode}-${viewport.width}.png` });
      if (mode === 'read') {
        const controls = await page.locator('.read-navigation > button, #read-measure').evaluateAll(els => els.map(el => {
          const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }));
        for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
          const a = controls[i], b = controls[j];
          assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, 'Reading controls must not overlap');
        }
        await page.locator('#read-measure').selectOption({ index: 1 });
        await page.locator('#read-go').click();
        assert.match(await page.locator('#read-location').textContent(), /measure 2/);
        await page.locator('#read-refit').click();
      } else {
        for (const selector of ['#paper-inspector', '#break-inspector', '#turn-inspector', '.print-options']) {
          await page.locator(`${selector} > summary`).click();
          assert.ok(await page.locator(selector).evaluate(el => el.open));
          assert.equal(await dock.evaluate(el => el.scrollWidth > el.clientWidth), false, `${selector}: no horizontal overflow`);
          await page.locator(`${selector} > summary`).click();
        }
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#paper-inspector > summary').click();
  await page.locator('#page-paper').selectOption('a4');
  await page.locator('#apply-pages').click();
  await page.waitForSelector('body[data-render-state="ready"]');
  assert.equal(await page.locator('#page-paper').inputValue(), 'a4');
  await page.locator('#paper-inspector > summary').click();
  await page.locator('.print-options > summary').click();
  await page.locator('#print-draft').check();
  await page.locator('#print-draft').uncheck();
  await page.locator('.print-options > summary').click();
  // Verify the print request only; native PDF output is outside this check.
  await page.evaluate(() => { window.__printRequests = 0; window.print = () => window.__printRequests++; });
  await page.locator('#print-score').click();
  await page.waitForFunction(() => window.__printRequests === 1);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#pages-tools').isVisible(), false);
  assert.equal(await page.locator('#page-host .score-page').first().isVisible(), true);
  await page.emulateMedia({ media: 'screen' });
  await page.locator('#view-write').click();
  assert.equal(await page.locator('#read-tools').isVisible(), false);
  assert.equal(await page.locator('#pages-tools').isVisible(), false);
  assert.equal(await page.locator('#workspace-dock').isVisible(), true);
  assert.deepEqual(errors, []);
  const result = { passed: true, browser: browser.version(), checks: ['bottom docks and independent preview scrolling', 'responsive native disclosures', 'Read measure navigation and refit', 'A4 settings and draft controls', 'print request and print media visibility', 'return to Write'], bounds };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
