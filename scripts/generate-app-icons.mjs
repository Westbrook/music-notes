// Rebuild committed raster icons using the repository's pinned Chromium.
// The essential artwork fits inside the maskable icon's central 80% circle.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const root = new URL('../public/', import.meta.url);
const svg = await readFile(new URL('icons/app.svg', root), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const pngs = new Map();
  for (const size of [16, 32, 152, 167, 180, 192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${svg}`);
    pngs.set(size, await page.screenshot());
  }
  for (const [name, size] of [['apple-touch-icon.png', 180], ['icons/apple-touch-icon-152.png', 152], ['icons/apple-touch-icon-167.png', 167], ['icons/app-192.png', 192], ['icons/app-512.png', 512], ['icons/app-maskable-512.png', 512], ['icons/favicon-32.png', 32]]) {
    await writeFile(new URL(name, root), pngs.get(size));
  }
  // ICO supports PNG image payloads, including these small favicon sizes.
  const header = Buffer.alloc(6 + 16 * 2);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(2, 4);
  let offset = header.length;
  [16, 32].forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size; header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(pngs.get(size).length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += pngs.get(size).length;
  });
  await writeFile(new URL('favicon.ico', root), Buffer.concat([header, pngs.get(16), pngs.get(32)]));
  console.log('Generated Apple touch, app, maskable and favicon assets.');
} finally {
  await browser.close();
}
