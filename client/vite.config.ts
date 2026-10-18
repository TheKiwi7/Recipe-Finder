import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  server: { port: 5318, proxy: { '/api': 'http://127.0.0.1:5317' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
