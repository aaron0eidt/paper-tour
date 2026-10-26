import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The paper folders under ../demo are served as static files:
// /<paper>/paper.pdf, /<paper>/doc.json, /<paper>/tour.json.
export default defineConfig({
  plugins: [react()],
  publicDir: '../demo',
  server: { port: 5173, strictPort: true },
  // pdf.js 4 uses modern syntax (top-level await, private methods) and is a large chunk by itself.
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
});
