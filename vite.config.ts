// Vite builds the app into dist/ (`npm run build`) and runs it while you work (`npm run dev`).
// The PWA plugin writes the web app manifest and a service worker that caches the whole app, so it
// installs to a phone's Home Screen and opens with no network. Vitest reads the `test` part.
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_DESCRIPTION, APP_NAME } from './src/brand.ts';

// Fills %APP_NAME% and %APP_DESCRIPTION% in index.html from src/brand.ts
const brandHtml = (): Plugin => ({
  name: 'brand-html',
  transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME).replaceAll('%APP_DESCRIPTION%', APP_DESCRIPTION),
});

export default defineConfig({
  plugins: [
    brandHtml(),
    react(),
    VitePWA({
      registerType: 'autoUpdate', // a new version takes over on the next open, no prompt
      injectRegister: false, // registered from src/main.tsx (no inline script: the CSP forbids those)
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_DESCRIPTION,
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
