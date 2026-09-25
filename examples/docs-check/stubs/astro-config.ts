// A minimal stand-in for `astro/config`, mapped in tsconfig.json's
// `paths` — this project doesn't install the real `astro` package (it
// isn't part of the dependency set task P12's review asked for), so
// INSTALL.md's Astro build-facts sample, which imports `defineConfig`
// from `astro/config`, needs something real to resolve against. Only
// the shape that sample actually uses is modelled: an object accepting a
// nested `vite` key, itself accepting Vite's own `define`.
export interface AstroUserConfig {
  vite?: {
    define?: Record<string, string>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function defineConfig(config: AstroUserConfig): AstroUserConfig {
  return config;
}
