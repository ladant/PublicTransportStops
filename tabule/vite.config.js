import { defineConfig } from 'vite';

// Aplikace je ve web/, výstup do dist/. Relativní base: funguje i v podsložce GitHub Pages.
// Při vývoji jde /v1/* na lokální proxy (npm run dev:proxy, port 8787).
export default defineConfig({
  root: 'web',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true },
  server: { proxy: { '/v1': 'http://localhost:8787' } },
});
