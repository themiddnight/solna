import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@jam-band/shared': path.resolve(__dirname, './shared/src/index.ts'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
