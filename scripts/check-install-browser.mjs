import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

// Development-server layout checks; isolated contexts never use personal recovery.
const base = process.env.INSTALL_TEST_URL ?? 'http://127.0.0.1:5175/';
const output = process.env.INSTALL_TEST_OUTPUT;
if (output) await mkdir(output, { recursive: true });
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true });
  try {
    const context = await browser.newContext({ hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const [width, height, top, right, bottom, left] of [
      [320, 568, 20, 0, 0, 0], [390, 844, 47, 0, 34, 0],
      [844, 390, 0, 47, 21, 47], [1024, 1366, 24, 0, 20, 0], [1366, 1024, 24, 0, 20, 0],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(new URL('author.html', base).href);
      await page.waitForSelector('body[data-author-ready="true"]');
      // Synthetic insets verify layout math, not OS-reported values or touch fidelity.
      await page.evaluate(({ top, right, bottom, left }) => {
        for (const [side, value] of Object.entries({ top, right, bottom, left })) {
          document.documentElement.style.setProperty(`--music-ui-safe-${side}`, `${value}px`);
        }
      }, { top, right, bottom, left });
      const pages = await page.locator('#view-pages').boundingBox();
      const undo = await page.locator('#undo').boundingBox();
      assert.ok(pages.x + pages.width <= undo.x || pages.y + pages.height <= undo.y, `${name} ${width}: Pages and Undo must not overlap`);
      const header = await page.locator('.app-header').boundingBox();
      assert.ok(header.y >= top && header.x >= left && header.x + header.width <= width - right + 1);
      for (const [view, dock] of [['write', '#workspace-dock'], ['read', '#read-tools'], ['listen', '#listen-tools'], ['pages', '#pages-tools']]) {
        await page.locator(`#view-${view}`).click();
        const box = await page.locator(dock).boundingBox();
        assert.ok(box && box.y + box.height <= height - bottom + 1, `${name} ${width}: ${view} clears Home indicator`);
        if (view === 'listen') assert.ok(await page.locator('#listen-tempo').evaluate(input => parseFloat(getComputedStyle(input).fontSize) >= 16));
      }
      await page.locator('#document-menu-trigger').click();
      await page.getByText('Install Music Notes', { exact: true }).click();
      const box = await page.locator('#document-menu').boundingBox();
      assert.ok(box.x >= left && box.y >= top && box.x + box.width <= width - right + 1 && box.y + box.height <= height - bottom + 1, `${name} ${width}: popover clears safe areas`);
      await page.getByText('Open the installed app online once', { exact: false }).scrollIntoViewIfNeeded();
      assert.ok(await page.getByText('Open the installed app online once', { exact: false }).isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (output) await page.screenshot({ path: `${output}/${name}-${width}.png` });
    }
    assert.deepEqual(errors, []);
    console.log(`${name} ${browser.version()}: phone/tablet views, native install disclosure and nonzero safe-area layout passed`);
  } finally { await browser.close(); }
}
