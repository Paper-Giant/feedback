import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const pagesRoot = fileURLToPath(new URL('./pages', import.meta.url));

export default defineConfig({
  root: pagesRoot,
  // No `dedupe` needed here (unlike the fixture's and react18's configs):
  // this page never imports React at all — `@papergiant/feedback/browser`
  // and `/server` are framework-free (design §3: "nothing touches the DOM
  // at import time", and neither entry imports `react`), so there is no
  // second-React-copy hazard to guard against.
  build: {
    outDir: resolve(pagesRoot, '../dist-pages'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(pagesRoot, 'index.html'),
      },
    },
  },
});
