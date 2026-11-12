import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Noren's API (hub, gas relay, assistant). Production: Vercel rewrites /api to it (web/vercel.json).
const api = { '/api': { target: process.env.NOREN_API ?? 'https://noren-avax-api.201-18-198-162.sslip.io', changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  resolve: { alias: { buffer: 'buffer/' } },
  optimizeDeps: { esbuildOptions: { define: { global: 'globalThis' } } },
  server: { port: 5361, proxy: api },
  preview: { port: 5361, proxy: api },
  build: { chunkSizeWarningLimit: 4000, target: 'es2022' },
});
