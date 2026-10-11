import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

/** See apps/admin-web/vite.config.ts for why the workspace packages are listed. */
const WORKSPACE_PACKAGES = [
  '@restor/api-client',
  '@restor/shared-types',
  '@restor/shared-utils',
  '@restor/ui',
];

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Where `npm run dev` forwards `/api`; override to point at another local API. */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  optimizeDeps: { include: WORKSPACE_PACKAGES },
  server: {
    port: 5177,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/uploads': { target: apiTarget, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: { include: [/node_modules/, /packages[\\/]/] },
    rollupOptions: {
      // The map (Leaflet) is split out by the lazy import in App.tsx.
      output: { manualChunks: { react: ['react', 'react-dom'] } },
    },
  },
});
