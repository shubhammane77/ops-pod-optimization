import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  bundle: true,
  minify: false,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
