import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

// Measure emitted files, including HTML and CSS, rather than source/module size.
// The optional directory makes before/after comparisons reproducible.
const directory = resolve(process.argv[2] ?? 'dist');
const manifest = JSON.parse(await readFile(resolve(directory, '.vite/manifest.json'), 'utf8'));
const budgets = { 'index.html': 50_000, 'author.html': 630_000 };

function graph(entry, includeDynamic = false, visited = new Set()) {
  if (visited.has(entry)) return visited;
  const chunk = manifest[entry];
  if (!chunk) throw new Error(`Missing build manifest entry: ${entry}`);
  visited.add(entry);
  for (const dependency of [...(chunk.imports ?? []), ...(includeDynamic ? chunk.dynamicImports ?? [] : [])]) {
    graph(dependency, includeDynamic, visited);
  }
  return visited;
}

const workbookGraph = graph('index.html', true);
for (const key of workbookGraph) {
  if (manifest[key].name === 'author' || manifest[key].name === 'author-ui') {
    throw new Error('The workbook must not download the Author application or its UI.');
  }
}

let failed = false;
for (const [entry, budget] of Object.entries(budgets)) {
  const files = new Set([entry]);
  for (const key of graph(entry)) {
    const chunk = manifest[key];
    files.add(chunk.file);
    for (const stylesheet of chunk.css ?? []) files.add(stylesheet);
    for (const asset of chunk.assets ?? []) files.add(asset);
  }
  let raw = 0; let gzip = 0;
  for (const file of files) {
    const content = await readFile(resolve(directory, file));
    raw += content.byteLength;
    gzip += gzipSync(content).byteLength;
  }
  console.log(`${entry}: ${(raw / 1000).toFixed(1)} kB raw, ${(gzip / 1000).toFixed(1)} kB gzip; initial budget ${(budget / 1000).toFixed(0)} kB gzip`);
  if (gzip > budget) failed = true;
}
if (failed) throw new Error('An initial delivery budget was exceeded. Review the import graph and measured cost.');
console.log('Workbook/Author separation verified, including dynamic imports.');
