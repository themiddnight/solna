import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Split the four biggest third-party trees out of the app chunk so
        // an app-code edit stops invalidating them in the browser cache.
        // Function form, not object form: react and react-dom are CJS, so
        // vite's commonjs plugin rewrites their module ids to `?commonjs-*`
        // suffixed forms that object-form entries cannot match — that form
        // emitted an empty vendor chunk and left the react family duplicated
        // across dndkit, icons and index.
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
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
});
