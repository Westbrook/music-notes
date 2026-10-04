import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Precache an entire release, including lazy audio and bundled music fonts. */
export function offlineApp(): Plugin {
  return {
    name: 'offline-app',
    apply: 'build',
    enforce: 'post',
    generateBundle: { order: 'post', handler(_options, bundle) {
      const files = new Map<string, string | Uint8Array>();
      for (const [name, output] of Object.entries(bundle)) {
        if (/\.(html|js|css)$/.test(name)) files.set(name, output.type === 'chunk' ? output.code : output.source);
      }
      const publicRoot = new URL('../public/', import.meta.url);
      for (const name of readdirSync(publicRoot, { recursive: true, encoding: 'utf8' })) {
        if (/\.(json|svg|png|ico)$/.test(name)) files.set(name, readFileSync(new URL(name, publicRoot)));
      }
      if (!files.has('author.html') || !files.has('index.html')) throw new Error('Offline build requires both HTML entries.');
      const hash = createHash('sha256');
      for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update(content);
      const integrity = Object.fromEntries([...files].map(([name, content]) => [name, `sha256-${createHash('sha256').update(content).digest('base64')}`]));
      const worker = readFileSync(join(import.meta.dirname, 'service-worker.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker
        .replace('__VERSION__', hash.digest('hex').slice(0, 16))
        .replace('__FILES__', JSON.stringify([...files.keys()].sort()))
        .replace('__INTEGRITY__', JSON.stringify(integrity)) });
    } },
  };
}
