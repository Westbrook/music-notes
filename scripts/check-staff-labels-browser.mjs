import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Reuse the isolated Author fixture; its recovery never touches the user's score.
const base = process.env.STAFF_LABELS_TEST_URL || 'http://127.0.0.1:5173';
const output = resolve(process.env.STAFF_LABELS_TEST_OUTPUT || '/tmp/music-notes-staff-labels');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 650, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/tests/authoring-listen-browser.html`);
  const ready = () => page.waitForSelector('body[data-author-ready="true"][data-render-state="ready"]');
  await ready();
  const source = await page.locator('music-staff#trombone-study').evaluate(el => el.outerHTML);
  const music = await page.locator('music-staff#trombone-study').evaluate(el => el.innerHTML);
  const observations = [];
  async function labels(mode, names, scenario) {
    const selector = mode === 'write' ? '#score-host .screen .system-row' : '#page-host .page-system';
    const geometry = await page.locator(selector).evaluateAll(elements => elements.map(el => ({
      labels: [...el.querySelectorAll('g.vf-staff-label')].map(label => label.textContent),
      labelLeft: el.querySelector('g.vf-staff-label text')?.getAttribute('x'),
      staffLeft: [...el.querySelectorAll('g.vf-music-staff')].map(staff => staff.querySelector('g.vf-stavebarline').getBBox().x),
      svgWidth: el.querySelector('svg').viewBox.baseVal.width,
    })));
    const rows = geometry.map(row => row.labels);
    assert.ok(rows.length > 1, `${scenario}: needs continuation systems`);
    assert.deepEqual(rows[0], names, `${scenario}: retain opening instrument names`);
    assert.ok(rows.slice(1).every(row => row.length === 0), `${scenario}: continuation systems must omit instrument names`);
    const opening = geometry[0];
    for (const row of geometry.slice(1)) {
      assert.ok(row.staffLeft.every(x => x < opening.staffLeft[0] - 20), `${scenario}: reclaim the label indent`);
      if (names.length === 1) assert.ok(Math.abs(row.staffLeft[0] - Number(opening.labelLeft)) < 1, `${scenario}: align with the opening label's left edge`);
      assert.ok(row.staffLeft.every(x => Math.abs(x - row.staffLeft[0]) < 1), `${scenario}: keep ensemble staves aligned`);
    }
    observations.push({ scenario, mode, systems: geometry });
  }
  async function mode(name) {
    await page.getByRole('button', { name, exact: true }).click();
    await ready();
  }
  async function apply(sourceHtml) {
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.locator('#source-input').fill(sourceHtml);
    await page.getByRole('button', { name: 'Apply source', exact: true }).click();
    await page.locator('#close-source').click();
    await ready();
  }
  await labels('write', ['Trombone'], 'two-line wrapping');
  await page.locator('music-staff#trombone-study').screenshot({ path: `${output}/write.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const viewport = document.querySelector('#score-host');
    const staff = viewport?.shadowRoot?.querySelector('music-staff');
    return (staff?.shadowRoot?.querySelectorAll('.screen .system-row').length ?? 0) >= 3;
  });
  await labels('write', ['Trombone'], 'narrow wrapping');
  await page.setViewportSize({ width: 1280, height: 900 });
  await mode('Pages');
  await labels('pages', ['Trombone'], 'physical pages');
  await page.locator('.score-page').first().screenshot({ path: `${output}/pages.png` });
  await mode('Write');
  assert.equal(await page.locator('music-staff#trombone-study').evaluate(el => el.innerHTML), music);
  assert.equal(await page.locator('music-staff#trombone-study').getAttribute('label'), 'Trombone');

  const pageBreak = source.replace('id="trombone-m3"', 'id="trombone-m3" break-before="page"');
  await apply(pageBreak);
  await mode('Pages');
  assert.equal(await page.locator('.score-page').count(), 2);
  await labels('pages', ['Trombone'], 'explicit page break');
  assert.equal(await page.locator('.score-page').nth(1).locator('g.vf-staff-label').count(), 0);
  await mode('Write');

  const secondStaff = pageBreak.replaceAll('id="', 'id="tuba-').replace('label="Trombone"', 'label="Tuba"');
  await apply(`<music-system id="duet">${pageBreak}${secondStaff}</music-system>`);
  await labels('write', ['Trombone', 'Tuba'], 'two instruments');
  await mode('Pages');
  await labels('pages', ['Trombone', 'Tuba'], 'two instruments across pages');
  assert.equal(await page.locator('#page-host g.vf-music-event').count(), 36);
  for (const bracket of ['brace', 'bracket']) {
    await mode('Write');
    await apply(`<music-system id="duet" bracket="${bracket}">${pageBreak}${secondStaff}</music-system>`);
    await labels('write', ['Trombone', 'Tuba'], `${bracket} spacing`);
    await mode('Pages');
    await labels('pages', ['Trombone', 'Tuba'], `${bracket} spacing across pages`);
    assert.ok(observations.at(-1).systems.slice(1).every(row => row.staffLeft.every(x => Math.abs(x - 28) < 1)), 'Retain connector space');
  }
  assert.deepEqual(errors, []);
  const result = { browser: browser.version(), passed: true, observations, sourcePreserved: true, pageErrors: errors };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
