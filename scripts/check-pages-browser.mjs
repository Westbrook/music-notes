import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

// Exercise the built site under its real project prefix, without SPA fallback.
// A fresh browser context isolates recovery from the user's compositions.
const directory = resolve('dist');
const prefix = '/music-notes/';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
await stat(resolve(directory, '.nojekyll'));
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!pathname.startsWith(prefix)) throw new Error('Outside the project');
    const file = resolve(directory, pathname.slice(prefix.length) || 'index.html');
    if (!file.startsWith(directory + sep)) throw new Error('Outside the build');
    const content = await readFile(file);
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
  browser = await chromium.launch({ headless: true });
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
  await page.goto(base);
  await page.locator('svg.notation-svg').first().waitFor();
  assert.ok(!loadedScripts.some(url => /\/author(?:-ui)?-/.test(url)), 'Workbook must not load Author');
  await page.getByRole('link', { name: 'Open Author', exact: true }).click();
  await page.waitForURL(`${base}author.html`);
  await page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
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
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ passed: true, browser: browser.version(), checks: ['project subpath assets', 'workbook/Author separation', 'both navigation links', 'score editing and engraving', 'lazy Listen chunk and WAV export', 'no page or network errors'] }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
