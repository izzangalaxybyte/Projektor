import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The Tizen build (phase 3) adds a second config with build.target 'chrome63'.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env['API_URL'] ?? 'http://localhost:8096', changeOrigin: true },
    },
  },
  build: { target: 'es2020', sourcemap: true },
});
