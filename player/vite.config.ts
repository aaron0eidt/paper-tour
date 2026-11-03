import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The paper folders under ../demo are served as static files:
// /<paper>/paper.pdf, /<paper>/doc.json, /<paper>/tour.json.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const storageOrigin = env.VITE_SUPABASE_URL ? new URL(env.VITE_SUPABASE_URL).origin : '';
  return {
    plugins: [
      react(),
      {
        name: 'private-image-policy',
        transformIndexHtml() {
          return [
            {
              tag: 'meta',
              attrs: {
                'http-equiv': 'Content-Security-Policy',
                content: `img-src 'self' data: blob: ${storageOrigin}; object-src 'none'; base-uri 'self'`,
              },
              injectTo: 'head-prepend' as const,
            },
          ];
        },
      },
    ],
    worker: { format: 'es' },
    publicDir: command === 'serve' ? '../demo' : false,
    server: { port: 5174, strictPort: true, proxy: { '/api': process.env.PAPER_TOUR_API_PROXY ?? 'http://127.0.0.1:3001' } },
    // pdf.js 4 uses modern syntax (top-level await, private methods) and is a large chunk by itself.
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
    optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  };
});
