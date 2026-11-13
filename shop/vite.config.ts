import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Locally, `vercel dev` serves the api/ functions; `pnpm dev` alone shows the storefront with the backend unreachable.
export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1' },
  build: { chunkSizeWarningLimit: 600 },
});
