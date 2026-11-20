// Vite builds the app into dist/ (`npm run build`) and runs it while you work (`npm run dev`).
// The PWA plugin writes the web app manifest and a service worker that caches the whole app, so it
// installs to a phone's Home Screen and opens with no network. Vitest reads the `test` part.
import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { APP_DESCRIPTION, APP_NAME } from './src/brand.ts';

// Fills %APP_NAME% and %APP_DESCRIPTION% in index.html from src/brand.ts
const brandHtml = (): Plugin => ({
  name: 'brand-html',
  transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME).replaceAll('%APP_DESCRIPTION%', APP_DESCRIPTION),
});

// PDF.js's data files (src/viewer/pdf.ts), served from our own site at /pdfjs/: standard fonts,
// character maps, WebAssembly image decoders and colour profiles, with their licences. Copied into
// the build, and served from node_modules while you work.
const PDFJS = 'node_modules/pdfjs-dist';
const PDFJS_DIRS = ['standard_fonts', 'cmaps', 'wasm', 'iccs'];
const pdfjsAssets = (): Plugin => ({
  name: 'pdfjs-assets',
  generateBundle() {
    for (const dir of PDFJS_DIRS) {
      for (const name of readdirSync(join(PDFJS, dir))) {
        if (/quickjs/i.test(name)) continue; // only for PDF scripting, which we never turn on
        this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: readFileSync(join(PDFJS, dir, name)) });
      }
    }
  },
  configureServer(server) {
    server.middlewares.use('/pdfjs/', (req, res, next) => {
      const [dir, name, ...rest] = (req.url ?? '').split('?')[0]!.split('/').filter(Boolean);
      if (!dir || !name || rest.length || !PDFJS_DIRS.includes(dir) || name.includes('..')) return next();
      const file = join(PDFJS, dir, name);
      try {
        if (!statSync(file).isFile()) return next();
      } catch {
        return next();
      }
      if (name.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
      createReadStream(file).pipe(res);
    });
  },
});

export default defineConfig({
  build: {
    // Fonts are never inlined as data: URLs (Vite inlines small files): the CSP allows fonts from our
    // own site only (font-src 'self'), so KaTeX's small fonts would be blocked. Other small files: Vite's default.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/i.test(file) ? false : undefined),
    rollupOptions: {
      // The app, and a page that shows the slide viewer on its own (src/viewer/demo.tsx) until the
      // lecture screens use it (#26); the browser tests drive it.
      input: { main: 'index.html', viewer: 'viewer-demo.html' },
    },
  },
  plugins: [
    brandHtml(),
    react(),
    pdfjsAssets(),
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
        background_color: '#272727', // docs/design: the dark grey
        theme_color: '#272727',
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
        // .mjs: PDF.js's worker. Its fonts and decoders are precached too, so slides open offline;
        // its character maps (for Chinese, Japanese and Korean text, 1.4 MB) are cached when used.
        // The app's font (Lexend, about 30 KB a file) too, so it looks the same offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,webmanifest,wasm}', 'assets/lexend-*.woff2', 'pdfjs/standard_fonts/*', 'pdfjs/iccs/*.icc'],
        globIgnores: ['pdfjs/**/LICENSE*', 'pdfjs/wasm/*_nowasm_fallback.js'], // the fallbacks: cached if ever used
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/pdfjs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-data' },
          },
        ],
        navigateFallback: '/index.html', // any page opened offline gets the app
        // Never for the AI helper (helper/, behind Cloudflare Access), nor for Cloudflare's own pages on
        // this site (/cdn-cgi/: after the Google sign-in, Access sets its cookie at
        // /cdn-cgi/access/authorized). They must reach the network, or there's no sign-in cookie.
        // Nor for the sync server (sync/, #95): Google sends the browser back to /api/auth/callback.
        navigateFallbackDenylist: [/^\/healthz/, /^\/ai(\/|$)/, /^\/api(\/|$)/, /^\/cdn-cgi\//],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.mjs'],
    environment: 'node',
  },
});
