import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The `@restor/*` workspace packages are compiled to CommonJS because the
 * NestJS backend consumes them too. Rollup does not convert linked (symlinked)
 * CJS dependencies by default, so both the dev pre-bundle and the production
 * build are told to include them explicitly.
 */
const WORKSPACE_PACKAGES = [
  '@restor/api-client',
  '@restor/shared-types',
  '@restor/shared-utils',
  '@restor/ui',
];

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: WORKSPACE_PACKAGES },
  server: {
    port: 5173,
    // Proxying in development means the browser sees a same-origin API, so
    // there is no CORS round trip and no cookie/SameSite surprises.
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: {
      // Without this the linked packages are left as CJS and Rollup cannot
      // resolve their named exports.
      include: [/node_modules/, /packages[\\/]/],
    },
    rollupOptions: {
      output: {
        // Splitting the vendor bundle keeps app deploys from invalidating the
        // (much larger, rarely changing) framework chunk in every browser.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
        },
      },
    },
  },
});
