import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', polyfill: 'src/polyfill.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
});
