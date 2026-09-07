import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  plugins: [vue()],
  root: import.meta.dirname,
  build: {
    emptyOutDir: false,
    outDir: resolve(import.meta.dirname, '../../dist/edge-web'),
    sourcemap: false,
  },
});
