# `examples/docs-check`

Compiles every fenced ` ```ts `/` ```tsx `/` ```js `/` ```mjs ` code sample in `../../INSTALL.md` and `../../README.md` against real host dependencies (Next 16, React 19, `@supabase/supabase-js` + `@supabase/ssr`, Hono, Vite), installing `@papergiant/feedback` itself from `file:../..`.

This is a stronger check than `test/docs.test.ts`'s export-name lookup — a real `tsc --strict --noEmit`, not just "does this name exist" — but it is **not yet wired into CI**: it is a separate, own-package-json project so it doesn't pull Next/React/Supabase into the package's own `devDependencies`, and it needs `dist/` built first (via the file: install) the same way the fixture does.

## Running it

```sh
cd ../..
npm run build            # dist/ must exist before `npm install` below
cd examples/docs-check
npm install
npm run check             # extracts every sample, then tsc --strict --noEmit
```

`npm run extract` alone (re)writes the extracted files without typechecking, useful while iterating.

## What's here

- **`extract-samples.mjs`** — reads `INSTALL.md` and `README.md`, and for every fenced `ts`/`tsx`/`js`/`mjs` block, writes it verbatim into this directory. A block's first line, when it's a `// path/to/file.ts` comment, is used as the write path (so `app/(app)/app-feedback.tsx` really lands there, and a relative import like `./app-feedback` from the layout sample resolves for real); a block with no such comment falls back to `samples/<doc>-<line>.<ext>`.
- **`lib/auth.ts`**, **`lib/supabase/server.ts`** — minimal stand-ins for a real host's own cookie-session and server-only Supabase client modules, which the Next recipe's route handler imports from `@/lib/auth` and `@/lib/supabase/server`. Not documented anywhere — they only exist so that *sample* compiles the way a host would actually write it.
- **`stubs/astro-config.ts`** — a minimal stand-in for `astro/config` (mapped via `tsconfig.json`'s `paths`), since this project doesn't install the real `astro` package. Only the one shape the Astro build-facts sample uses is modelled.
- **`tsconfig.json`** — deliberately close to a real bundler-resolved host's config (`moduleResolution: "bundler"`, `jsx: "preserve"`, `types: ["node", "vite/client"]` so `import.meta.env.*` in the framework-free sample resolves), `allowJs`/`checkJs` so the `.mjs` build-facts samples are checked too, and `strict: true`.

Every sample currently passes. Re-run `npm run check` after any change to `INSTALL.md` or `README.md`'s code blocks, or after this package's public API changes.
