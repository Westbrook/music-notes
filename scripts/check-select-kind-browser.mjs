import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.SELECT_TEST_URL || 'http://127.0.0.1:5173';
const output = process.env.SELECT_TEST_OUTPUT || '/tmp/music-notes-select-kind';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/tests/authoring-listen-browser.html`);
  const ready = () => page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
  await ready();
  const load = async source => {
    await page.locator('#source-trigger').click();
    await page.locator('#source-input').fill(source);
    await page.locator('#source-apply').click(); await page.locator('#close-source').click(); await ready();
  };
  await load('<music-staff id="staff"><music-measure id="bar" incomplete><music-note id="a" pitch="F#4" duration="quarter"></music-note><music-rest id="b" duration="eighth" dots="1"><music-articulation id="fermata" type="fermata"></music-articulation></music-rest><music-note id="c" pitch="A4" duration="eighth"></music-note></music-measure></music-staff>');
  const group = page.locator('#selection-kind');
  const choice = value => group.locator(`.controls > button[value="${value}"]`);
  const choose = async value => {
    if (await choice(value).isVisible()) await choice(value).click();
    else await group.locator('select').selectOption(value);
  };
  const glyph = id => page.locator(`#score-host .screen g.vf-music-event[data-source-id="${id}"]`);
  const source = page.locator('music-staff#staff');
  const html = () => source.evaluate(element => element.outerHTML);
  await glyph('a').click();
  assert.equal(await group.evaluate(element => element.nextElementSibling.id), 'selection-accidentals');
  const before = await html();
  await choose('rest'); await ready();
  assert.equal(await source.locator('music-rest#a').count(), 1);
  assert.equal(await source.locator('#a').getAttribute('duration'), 'quarter');
  await choose('note'); await ready();
  assert.equal(await page.locator('#selection-kind-chooser').count(), 0);
  assert.equal(await source.locator('music-note#a').getAttribute('pitch'), 'B4');
  await page.locator('#undo').click(); await ready();
  assert.equal(await source.locator('music-rest#a').count(), 1);
  await page.locator('#undo').click(); await ready();
  assert.equal(await html(), before);
  await glyph('b').click();
  await choice('note').focus(); await page.keyboard.press('Enter'); await ready();
  assert.equal(await source.locator('music-note#b').getAttribute('pitch'), 'B4');
  assert.equal(await source.locator('#b').getAttribute('dots'), '1');
  assert.equal(await source.locator('#b #fermata').count(), 1);
  for (const width of [1440, 1100, 390, 320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(150); // Allow the shared ResizeObserver row to settle.
    await choose('rest'); await ready();
    const bounds = await group.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: `${output}/${width}.png` });
    await choose('note'); await ready();
    assert.equal(await source.locator('music-note#b').getAttribute('pitch'), 'B4');
  }
  for (const notation of ['rhythm', 'three-roads']) {
    await load(`<music-staff id="staff" notation="${notation}"><music-measure id="bar" incomplete><music-rest id="b" duration="quarter"></music-rest></music-measure></music-staff>`);
    await glyph('b').click(); await choose('note');
    await ready();
    assert.equal(await source.locator(notation === 'rhythm' ? 'music-rhythm#b' : 'music-road#b').count(), 1);
    if (notation === 'three-roads') assert.equal(await source.locator('#b').getAttribute('direction'), 'same');
    await choose('rest'); await ready();
    assert.equal(await source.locator('music-rest#b').count(), 1);
  }
  for (const [clef, key, pitch] of [['treble','F','Bb4'],['bass','C','D3'],['alto','D','C#4'],['tenor','C','A3']]) {
    await load(`<music-staff id="staff" clef="${clef}" key="${key}"><music-measure id="bar" incomplete><music-rest id="b" duration="quarter"></music-rest></music-measure></music-staff>`);
    await glyph('b').click(); await choose('note'); await ready();
    assert.equal(await source.locator('music-note#b').getAttribute('pitch'), pitch);
    await page.screenshot({ path: `${output}/middle-${clef}.png` });
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Select Note/Rest; immediate middle-line notes in all clefs/keys, keyboard, exact Undo, markings, rhythm/roads and 320–1440px layouts.');
} finally { await browser.close(); }
