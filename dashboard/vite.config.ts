import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ mode }) => {
  // Third argument '' loads every key, not just the VITE_-prefixed ones. This
  // one configures the dev server rather than the bundle, so it is read here
  // and never reaches client code.
  const env = loadEnv(mode, process.cwd(), '');
  const devApiProxy = env.VITE_DEV_API_PROXY || 'http://localhost:4000';

  /**
   * Fail the build, not the browser.
   *
   * `src/config/env.ts` throws on the same condition, but that only surfaces
   * once someone opens the deployed site. Checking here means a Vercel build
   * missing the variable goes red and never gets promoted, which is the point
   * at which it is cheap to fix.
   */
  if (mode === 'production' && !env.VITE_API_ORIGIN?.trim()) {
    throw new Error(
      'VITE_API_ORIGIN is not set.\n\n' +
        'A production build inlines the API origin into the bundle. Without it ' +
        'the dashboard would request the API from its own domain and receive ' +
        'index.html for every call.\n\n' +
        'Set VITE_API_ORIGIN (for example https://api.example.com) for this ' +
        'environment and rebuild. See docs/DEPLOYMENT.md.'
    );
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        /**
         * Development only, and deliberately not a model of production.
         *
         * Deployed, the dashboard and the API are separate origins: the bundle
         * calls VITE_API_ORIGIN directly and the backend's CORS allowlist has
         * to name the dashboard's domain. A Vercel rewrite cannot reproduce
         * this proxy, because rewrites are static and so cannot point Preview
         * at the staging API while Production uses its own.
         */
        '/api': {
          target: devApiProxy,
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
  };
});
