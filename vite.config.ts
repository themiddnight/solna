import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
