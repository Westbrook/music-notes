import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [{
    name: 'third-party-notices',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_NOTICES.txt',
        source: readFileSync(new URL('./THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'),
      });
    },
  }],
  build: {
    rollupOptions: {
      input: {
        workbook: fileURLToPath(new URL('./index.html', import.meta.url)),
        author: fileURLToPath(new URL('./author.html', import.meta.url)),
      },
      output: {
        // Embedded fonts are stable, relatively large assets. Cache them apart
        // from the adapter, so editing notation code does not redownload fonts.
        manualChunks(id) {
          if (id.includes('/vexflow/build/esm/src/fonts/')) return 'notation-fonts';
        },
      },
    },
  },
});
