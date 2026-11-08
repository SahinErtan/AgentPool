import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server proxies the API and the WebSocket to the local AgentPool backend,
// so the frontend always talks to the same origin it will use in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:38000', changeOrigin: true },
      '/hooks': { target: 'http://127.0.0.1:38000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:38000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
