import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium, webkit } from 'playwright';

// Exercise the built site under its real project prefix, without SPA fallback.
// A fresh browser context isolates recovery from the user's compositions.
const directory = resolve(process.env.TEST_DIST ?? 'dist');
const prefix = process.env.TEST_BASE_PATH ?? '/music-notes/';
const engine = process.env.TEST_BROWSER === 'webkit' ? webkit : chromium;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
let workerVariant = 0;
let networkUnavailable = false;
await stat(resolve(directory, '.nojekyll'));
const server = createServer(async (request, response) => {
  if (networkUnavailable) { request.socket.destroy(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) throw new Error('Outside the project');
    const file = resolve(directory, pathname.slice(prefix.length) || 'index.html');
    if (!file.startsWith(directory + sep)) throw new Error('Outside the build');
    let content = await readFile(file);
    if (workerVariant === 3 && pathname.endsWith('/icons/app.svg')) content = Buffer.concat([content, Buffer.from('<!-- changed release -->')]);
    if (pathname.endsWith('/sw.js') && workerVariant) {
      let source = content.toString().replace(/const version = '([^']+)'/, `const version = '$1-test-${workerVariant}'`);
      if (workerVariant === 1) source = source.replace('const files = [', 'const files = ["missing-precache.txt",');
      content = Buffer.from(source);
    }
    response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
let browser;
try {
  browser = await engine.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const failures = [];
  const loadedScripts = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => failures.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('response', response => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
    if (response.request().resourceType() === 'script') loadedScripts.push(response.url());
  });
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  async function checkInstallation() {
    const manifestUrl = await page.locator('link[rel="manifest"]').evaluate(link => link.href);
    assert.equal(manifestUrl, `${base}manifest.json`);
    const response = await context.request.get(manifestUrl);
    assert.equal(response.status(), 200);
    const manifest = await response.json();
    assert.equal(manifest.display, 'standalone');
    assert.equal(new URL(manifest.id, manifestUrl).href, base);
    assert.equal(new URL(manifest.start_url, manifestUrl).href, `${base}author.html`);
    assert.equal(new URL(manifest.scope, manifestUrl).href, base);
    assert.equal(await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute('content'), 'yes');
    const icons = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll(links => links.map(link => link.href));
    for (const icon of manifest.icons) icons.push(new URL(icon.src, manifestUrl).href);
    for (const url of icons) {
      assert.ok(url.startsWith(base), `Icon stays in deployment scope: ${url}`);
      const response = await context.request.get(url);
      assert.equal(response.status(), 200, url);
      assert.match(response.headers()['content-type'], /^image\//);
    }
    // Decode the actual raster files, rather than trusting manifest size strings.
    for (const icon of manifest.icons) {
      const dimensions = await page.evaluate(async url => {
        const image = new Image(); image.src = url; await image.decode();
        return `${image.naturalWidth}x${image.naturalHeight}`;
      }, new URL(icon.src, manifestUrl).href);
      assert.equal(dimensions, icon.sizes);
    }
    assert.ok(manifest.icons.some(icon => icon.purpose === 'maskable' && icon.sizes === '512x512'));
    for (const shortcut of manifest.shortcuts) {
      const url = new URL(shortcut.url, manifestUrl).href;
      assert.ok(url.startsWith(base));
      assert.equal((await context.request.get(url)).status(), 200);
    }
  }
  await page.goto(base);
  await page.locator('svg.notation-svg').first().waitFor();
  await checkInstallation();
  assert.ok(!loadedScripts.some(url => /\/author(?:-ui)?-/.test(url)), 'Workbook must not load Author');
  await page.getByRole('link', { name: 'Open Author', exact: true }).click();
  await page.waitForURL(`${base}author.html`);
  await page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
  await checkInstallation();
  await page.waitForFunction(() => document.querySelector('music-offline-status')?.shadowRoot?.textContent?.includes('Ready for offline use'));
  await page.evaluate(async () => {
    const name = (await caches.keys()).find(name => name.startsWith('music-notes:'));
    await (await caches.open(name)).delete(new URL('icons/app-192.png', location.href));
  });
  await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.waitForFunction(() => document.querySelector('music-offline-status')?.shadowRoot?.textContent?.includes('Ready for offline use'));
  assert.equal(await page.evaluate(async () => Boolean(await caches.match(new URL('icons/app-192.png', location.href)))), true, 'Online startup repairs evicted offline files');
  // WebKit's Playwright offline toggle errors before SW navigation dispatch in
  // this pinned build. Drop actual server connections to exercise network loss.
  if (engine === webkit) networkUnavailable = true;
  else await context.setOffline(true);
  await page.goto(`${base}author.html?offline-check=1`);
  await page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
  assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
  assert.equal(await page.getByRole('link', { name: 'Notation workbook', exact: true }).getAttribute('href'), `${prefix}index.html`);
  await page.locator('#source-trigger').click();
  await page.locator('#source-input').fill('<music-staff clef="treble"><music-measure><music-note pitch="C4" duration="whole"></music-note></music-measure></music-staff>');
  await page.locator('#source-apply').click();
  await page.locator('#close-source').click();
  await page.waitForSelector('body[data-render-state="ready"]');
  await page.locator('#view-listen').click();
  const downloading = page.waitForEvent('download');
  await page.locator('#listen-download').click();
  const download = await downloading;
  assert.equal(await download.failure(), null);
  const wav = await readFile(await download.path());
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.ok(loadedScripts.some(url => url.includes('listen-controller-')), 'Listen must load its production chunk');
  await page.getByRole('link', { name: 'Music Notes notation workbook', exact: true }).click();
  await page.waitForURL(`${base}index.html`);
  await page.locator('svg.notation-svg').first().waitFor();
  await context.setOffline(false);
  networkUnavailable = false;
  assert.deepEqual(failures, []);
  if (engine === chromium) {
    await page.evaluate(async () => {
      await (await caches.open('unrelated-test-cache')).put(new URL('unrelated', location.href), new Response('keep'));
    });
    async function updateWorker() {
      return page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration.update();
        const worker = registration.installing ?? registration.waiting;
        if (!worker) throw new Error('Expected an update worker');
        return new Promise(resolve => {
          const check = () => {
            if (['installed', 'redundant'].includes(worker.state)) {
              worker.removeEventListener('statechange', check); resolve(worker.state);
            }
          };
          worker.addEventListener('statechange', check); check();
        });
      });
    }
    workerVariant = 1;
    assert.equal(await updateWorker(), 'redundant', 'A partial precache must fail installation');
    assert.equal(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state), 'activated');
    workerVariant = 3;
    assert.equal(await updateWorker(), 'redundant', 'Mixed-release bytes must fail integrity verification');
    workerVariant = 2;
    assert.equal(await updateWorker(), 'installed', 'A complete update waits while the editor is open');
    assert.equal(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), true);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${base}author.html`);
    await reopened.waitForFunction(async () => {
      const names = (await caches.keys()).filter(name => name.startsWith('music-notes:'));
      return names.length === 1 && names[0].endsWith('-test-2');
    });
    assert.equal(await reopened.evaluate(() => caches.has('unrelated-test-cache')), true, 'Only this app release cache is cleaned');
    console.log('Failed-install recovery, waiting updates, activation and scoped cache cleanup passed.');
  }
  console.log(JSON.stringify({ passed: true, browser: browser.version(), basePath: prefix, checks: ['project subpath assets', 'manifest identity, scope, launch and shortcuts', 'Apple metadata and decoded app icons', 'workbook/Author separation', 'both navigation links', 'offline startup, score editing and engraving', 'offline lazy Listen chunk and WAV export', 'offline workbook navigation', 'no page or network errors'] }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
