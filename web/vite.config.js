import { defineConfig } from 'vite';

// base './' = funguje v podadresáři (GitHub Pages /repo/) i v kořeni domény
export default defineConfig({
  base: './',
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
  worker: { format: 'es' },
});
