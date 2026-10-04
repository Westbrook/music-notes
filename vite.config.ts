import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { offlineApp } from './build/offline.js';

export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/music-notes/' : '/',
  plugins: [offlineApp(), {
    name: 'local-progress-report',
    apply: 'serve',
    transformIndexHtml() {
      // Trusted local project configuration; never take a destination from a query.
      const locator = new URL('./.progress-report/project.json', import.meta.url);
      if (!existsSync(locator)) return;
      const { reportUrl } = JSON.parse(readFileSync(locator, 'utf8'));
      return [{ tag: 'script', injectTo: 'body', children: `
        if (new URL(location.href).searchParams.has('progress-report') && !document.getElementById('report-return')) {
          const link = document.createElement('a');
          link.id = 'report-return'; link.href = ${JSON.stringify(reportUrl)}; link.textContent = 'Progress Report';
          link.style.cssText = 'position:fixed;right:calc(16px + env(safe-area-inset-right, 0px));bottom:calc(170px + env(safe-area-inset-bottom, 0px));z-index:10000;background:white;color:#5131ad;border:1px solid #d1c4eb;border-radius:99px;padding:12px 16px;font:14px system-ui;text-decoration:underline;box-shadow:0 2px 8px #0002';
          document.body.append(link);
          document.addEventListener('click', event => {
            const anchor = event.target.closest?.('a[href]');
            if (!anchor || anchor === link) return;
            const url = new URL(anchor.href);
            if (url.origin === location.origin) { url.searchParams.set('progress-report', ''); anchor.href = url.href; }
          }, true);
        }
      ` }];
    },
  }, {
    name: 'third-party-notices',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '.nojekyll', source: '' });
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.txt',
        source: readFileSync(new URL('./THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
      });
    },
  }],
  build: {
    manifest: true,
    rollupOptions: {
      input: {
        workbook: fileURLToPath(new URL('./index.html', import.meta.url)),
        author: fileURLToPath(new URL('./author.html', import.meta.url)),
      },
      output: {
        onlyExplicitManualChunks: true,
        // Embedded fonts are stable, relatively large assets. Cache them apart
        // from the adapter, so editing notation code does not redownload fonts.
        manualChunks(id) {
          if (id.includes('/vexflow/build/esm/src/fonts/')) return 'notation-fonts';
          // Shared, pinned runtimes can stay cached across application changes.
          if (/\/node_modules\/(?:lit(?:-html|-element)?\/|@lit\/|signal-polyfill\/|signal-utils\/)/.test(id)) return 'ui-runtime';
          // Native presentation templates change independently of commands.
          if (id.includes('/src/authoring/ui/')) return 'author-ui';
        },
      },
    },
  },
}));
