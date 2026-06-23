import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxies /api to the StreetJS MarzPay backend during development.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
