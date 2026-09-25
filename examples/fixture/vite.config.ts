import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pagesRoot = fileURLToPath(new URL('./pages', import.meta.url));

export default defineConfig({
  root: pagesRoot,
  plugins: [react()],
  resolve: {
    // `@papergiant/feedback` is a real dependency now (task P10; see
    // package.json and README.md): `"file:../.."` for local development
    // (npm creates a symlink at node_modules/@papergiant/feedback back to
    // the package root, so its *built* dist/ is picked up live — build the
    // root package first, same as before), or a real, unpacked copy of the
    // packed tarball in CI (`npm install --no-save` a freshly `npm
    // pack`ed tarball, after `npm ci` — see the root README/CI workflow).
    // No alias is needed any more: both `@papergiant/feedback/browser` and
    // `@papergiant/feedback/react` resolve through the package's own
    // `exports` map, exactly as a real consumer would get them.
    //
    // `dedupe` guards against the one hazard specific to the symlinked
    // (local-dev) case: without it, a bare `import 'react'` inside the
    // *linked* package's compiled `dist/react/index.js` can resolve, via
    // Vite's own symlink-following resolver, to the root package's own
    // `react` devDependency instead of this fixture's — two separate
    // React module instances in one page, which breaks hooks/context
    // between `<FeedbackProvider>` and its consumers even when both
    // copies are the same version. Forces every `react`/`react-dom`
    // import, wherever it originates, to resolve to this project's own
    // copy. Harmless, and unnecessary, once the tarball is installed as a
    // real (non-symlinked) copy — but always correct to set.
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: resolve(pagesRoot, '../dist-pages'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        vanilla: resolve(pagesRoot, 'vanilla.html'),
        react19: resolve(pagesRoot, 'react19.html'),
        radix: resolve(pagesRoot, 'radix.html'),
      },
    },
  },
});
