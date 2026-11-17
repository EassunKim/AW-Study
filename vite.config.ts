// Vite builds the app into dist/ (`npm run build`) and runs it while you work (`npm run dev`).
// The PWA plugin writes the web app manifest and a service worker that caches the whole app, so it
// installs to a phone's Home Screen and opens with no network. Vitest reads the `test` part.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // a new version takes over on the next open, no prompt
      injectRegister: false, // registered from src/main.tsx (no inline script: the CSP forbids those)
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'AW-Study',
        short_name: 'AW-Study',
        description: 'Spaced repetition for lecture content, with your data kept on your own device',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#111827',
        theme_color: '#111827',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Take charge of the open page at once, so the very first visit already works offline
        clientsClaim: true,
        skipWaiting: true,
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,wasm}'],
        navigateFallback: '/index.html', // any page opened offline gets the app
        navigateFallbackDenylist: [/^\/healthz/],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.mjs'],
    environment: 'node',
  },
});
