import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { renameSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const mobile = mode === 'android' || mode === 'ios';
  return ({
  base: './',
  plugins: [react(), ...(mobile ? [{ name: 'mobile-entry', apply: 'build' as const, closeBundle() { renameSync(`dist-${mode}/index.${mode}.html`, `dist-${mode}/index.html`); } }] : [])],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: mobile ? { outDir: `dist-${mode}`, rollupOptions: { input: `index.${mode}.html` } } : { outDir: 'dist' },
});
});
