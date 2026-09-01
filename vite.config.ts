import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt`, never `autoUpdate`. Applying a new worker means reloading the
      // page, and a reload tears down the AudioContext — doing that on its own
      // schedule would cut the user off mid-loop. src/pwa/ surfaces the waiting
      // worker and lets them pick the moment.
      registerType: 'prompt',
      // The registration lives in src/pwa/serviceWorker.ts rather than in an
      // injected snippet, so the update handshake is ours and is unit-tested.
      injectRegister: null,
      // public/assets/site.webmanifest is hand-written and already linked from
      // index.html. Generating a second one would change the manifest URL, and
      // a manifest at a new URL reads as a DIFFERENT app to an installed client.
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // og.png is a 210KB social-preview card the app itself never renders.
        globIgnores: ['**/og.png', '**/screenshot-*.png'],
        // Every in-app route (/loop, /song) is served by the same document, so
        // an offline deep link has to resolve to the shell rather than 404.
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // The font CSS names hashed font files, so it must be allowed to
            // refresh — served from cache first, revalidated behind the user.
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            // The font files themselves are immutable and hashed: cache first,
            // for a year. Without this the app falls back to system fonts the
            // moment it is opened offline.
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
              // Opaque cross-origin responses report status 0.
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Split the four biggest third-party trees out of the app chunk so
        // an app-code edit stops invalidating them in the browser cache.
        // Function form: Vite 8 (Rolldown) removed the object form, and
        // matching by node_modules path holds regardless of CJS interop.
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return;
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) {
            return 'vendor';
          }
          if (id.includes('/node_modules/tonal/') || id.includes('/node_modules/@tonaljs/')) {
            return 'tonal';
          }
          if (id.includes('/node_modules/@dnd-kit/')) {
            return 'dndkit';
          }
          if (id.includes('/node_modules/lucide-react/')) {
            return 'icons';
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
