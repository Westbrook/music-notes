import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

// Exercise the real production bundler with one explicitly imported icon. A
// runtime catalog, dynamic loader, or font dependency would fail these checks.
const source = fileURLToPath(new URL('../src/ui/', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'music-notes-icon-delivery-'));
try {
  for (const sample of [
    { family: 'phosphor', symbol: 'phArrowUUpLeft', name: 'ph:arrow-u-up-left', label: 'Undo' },
    { family: 'bravura', symbol: 'bravuraNoteQuarterUp', name: 'music:noteQuarterUp', label: 'Quarter' },
  ]) {
    const entry = join(temporary, `${sample.family}.ts`);
    await writeFile(entry, [
      `import { buttonContent } from ${JSON.stringify(join(source, 'button-content.ts'))};`,
      `import { ${sample.symbol} } from ${JSON.stringify(join(source, 'icons', `${sample.family}.ts`))};`,
      `export const content = () => buttonContent(${sample.symbol}, ${JSON.stringify(sample.label)});`,
    ].join('\n'));
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        target: 'es2022',
        minify: true,
        lib: { entry, formats: ['es'] },
        rollupOptions: { external: id => id === 'lit' || id.startsWith('lit/') },
      },
    });
    const chunks = (Array.isArray(result) ? result : [result]).flatMap(item => item.output).filter(item => item.type === 'chunk');
    assert.equal(chunks.length, 1, `${sample.family}: icon delivery must emit one synchronous chunk`);
    const [chunk] = chunks;
    assert.deepEqual(chunk.dynamicImports, [], `${sample.family}: no deferred icon imports`);
    assert(!Object.keys(chunk.modules).some(id => id.includes('/vexflow/')), `${sample.family}: control icons must not load engraving or fonts`);
    assert(!/FontFace|document\.fonts|measureText/.test(chunk.code), `${sample.family}: artwork must not wait for font measurement`);
    const included = [...new Set([...chunk.code.matchAll(/["']((?:ph|music):[\w-]+)["']/g)].map(match => match[1]))].sort();
    assert.deepEqual(included, [sample.name], `${sample.family}: unused icon definitions must be removed`);
    console.log(`${sample.name}: one synchronous icon, ${(gzipSync(chunk.code).length / 1000).toFixed(1)} kB gzip excluding the shared Lit runtime`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
