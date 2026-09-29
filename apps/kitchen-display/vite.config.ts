import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** See apps/admin-web/vite.config.ts for why the workspace packages are listed. */
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
    port: 5176,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    commonjsOptions: { include: [/node_modules/, /packages[\\/]/] },
  },
});
