import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { renameSync } from 'node:fs';

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'android' ? [{ name: 'android-entry', apply: 'build' as const, closeBundle() { renameSync('dist-android/index.android.html', 'dist-android/index.html'); } }] : [])],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
  build: mode === 'android' ? { outDir: 'dist-android', rollupOptions: { input: 'index.android.html' } } : { outDir: 'dist' },
}));
