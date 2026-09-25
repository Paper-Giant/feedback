import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pagesRoot = fileURLToPath(new URL('./pages', import.meta.url));

export default defineConfig({
  root: pagesRoot,
  plugins: [react()],
  resolve: {
    // See examples/fixture/vite.config.ts for why this matters: without
    // it, a bare `import 'react'` inside the linked package's compiled
    // `dist/react/index.js` can resolve (via Vite's symlink-following
    // resolver) to a *different* React than this project's own — and here
    // that hazard is sharper than the fixture's, because the two React
    // majors genuinely differ (this project's react@18.3.x vs. the
    // package root's own react@19.3.x devDependency): a mismatch would be
    // silently wrong rather than merely duplicated. `dedupe` forces every
    // react/react-dom import, wherever it originates, to resolve to this
    // project's own copy.
    dedupe: ['react', 'react-dom'],
  },
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
