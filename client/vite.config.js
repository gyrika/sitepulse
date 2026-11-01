import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Must match CORS_ORIGINS on the server, which allows http://localhost:5173.
    host: 'localhost',
    port: 5173,
    strictPort: true,
    // The browser only ever talks to one origin, so the session cookie just works.
    proxy: { '/api': 'http://127.0.0.1:4000' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['tests/setup.js'],
    include: ['tests/**/*.test.{js,jsx}'],
  },
});
