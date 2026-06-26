import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxies /api and /auth to the Street backend during development.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/search': 'http://localhost:3000',
    },
  },
});
