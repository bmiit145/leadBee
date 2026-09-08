import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Same-origin during development, so the browser never sees a
      // cross-origin request and cookies/CORS behave as they do in production.
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        /**
         * MUI and React are large and change rarely; splitting them keeps a
         * routine app deploy from busting the whole vendor cache.
         *
         * The function form rather than the object map: the object form is no
         * longer accepted by this bundler's types.
         */
        manualChunks(id: string) {
          if (id.includes('node_modules/@mui') || id.includes('node_modules/@emotion')) {
            return 'mui';
          }
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/scheduler')
          ) {
            return 'vendor';
          }
          return undefined;
        },
      },
    },
  },
});
