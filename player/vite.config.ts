import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The paper folders under ../demo are served as static files:
// /<paper>/paper.pdf, /<paper>/doc.json, /<paper>/tour.json.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  worker: { format: 'es' },
  publicDir: command === 'serve' ? '../demo' : false,
  server: { port: 5174, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3001' } },
  // pdf.js 4 uses modern syntax (top-level await, private methods) and is a large chunk by itself.
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
}));
