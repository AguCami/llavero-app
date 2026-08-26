import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build alternativo: un único bundle sin módulos ni trozos separados, para
 * poder empotrarlo entero en un solo archivo HTML (ver scripts/build-single.mjs).
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app[extname]',
      },
    },
  },
});
