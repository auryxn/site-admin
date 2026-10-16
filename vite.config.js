import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Public site (index) + admin SPA (admin.html) as two Vite build entries.
// During `vite` dev, /api calls are proxied to the backend on :4200.
//
// Deployment modes:
//   - local (`npm start` + `npm run dev`): BASE='/', admin included, live API.
//   - GitHub Pages legacy (PAGES_BASE=/ VITE_STATIC=1 npm run build):
//     root base, static data snapshot, admin excluded from the build.
const PAGES = process.env.PAGES_BASE || '/';
const STATIC = process.env.VITE_STATIC === '1';

const input = { main: resolve(__dirname, 'index.html') };
// Admin panel needs a backend (auth + write API); skip it for static Pages build.
if (!STATIC) input.admin = resolve(__dirname, 'admin.html');

export default defineConfig({
  plugins: [react()],
  base: PAGES,
  build: {
    outDir: STATIC && process.env.PAGES_BASE ? process.env.DIST_OUT || 'dist' : 'dist',
    rollupOptions: { input },
  },
  server: {
    port: 4201,
    proxy: {
      '/api': 'http://localhost:4200',
      '/uploads': 'http://localhost:4200',
    },
  },
});
