import { defineConfig } from 'tsdown'

/**
 * The CLI ships compatibility and SivitaCode entries from package.json `bin`.
 * The root tsdown builds only `lib/types/index.js`, so this override points at
 * both executable sources; their reachable mode modules bundle with them.
 * Declarations come from `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/bin.js', 'lib/types/sivitacode.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
