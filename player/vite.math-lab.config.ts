import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
/** Separate build: exploration dependencies never enter the reader entry point. */
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: { target: 'es2022', outDir: 'dist-math-lab', rollupOptions: { input: 'math-lab.html' } },
});
