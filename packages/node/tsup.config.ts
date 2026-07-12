import { defineConfig } from 'tsup';

// A single entry, dual ESM+CJS build with type defs (Contract §6 — "Node
// consumers span both; a server SDK should not force ESM"). Unlike
// @push-to/web, there is no build-time-inlined constant (baseUrl is a
// runtime constructor default, Contract §2) and no second "drop-in" bundle
// target — so, unlike web-sdk's tsup.config.ts, this needs neither `dotenv`
// nor a second config entry.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  outDir: 'dist',
  treeshake: true,
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.js' : '.cjs',
    };
  },
});
