import { defineConfig, type Options } from 'tsup';

/**
 * Shared tsup preset for every package in the Astroid SDK monorepo.
 *
 * Workspace dependencies (`@astroid/*`) and declared peer dependencies are kept
 * external so each package stays thin and installs resolve through the pnpm
 * workspace symlinks. Build order is topological (pnpm -r), so a package's
 * dependencies are always compiled — with their `.d.ts` — before it builds.
 */
export function astroidTsup(overrides: Partial<Options> = {}): ReturnType<typeof defineConfig> {
  return defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    target: 'es2022',
    outDir: 'dist',
    ...overrides,
  });
}
