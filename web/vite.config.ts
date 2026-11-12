import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  resolve: { alias: { buffer: 'buffer/' } },
  optimizeDeps: { esbuildOptions: { define: { global: 'globalThis' } } },
  server: { port: 5361 },
  preview: { port: 5361 },
  build: { chunkSizeWarningLimit: 4000, target: 'es2022' },
});
