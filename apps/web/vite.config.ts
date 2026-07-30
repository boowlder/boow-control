import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      '@boow/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      // Attendu par shadcn/ui : ses composants s'importent tous en `@/…`.
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    // 0.0.0.0 : joignable via l'IP WSL depuis Windows même si le relai localhost de WSL est coincé.
    host: true,
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8788', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8788', ws: true },
    },
  },
  build: {
    // Chunking par défaut de Vite (le découpage manuel cassait l'ordre d'init des vendors).
    chunkSizeWarningLimit: 1500,
  },
});
