import { defineConfig } from 'vite';

export default defineConfig({
  build: { target: 'es2022' },
  server: {
    open: false,
    // dev-only: serve production server maps so ?map=server:<name> works locally
    proxy: { '/maps': { target: 'https://simulator.arkana.app', changeOrigin: true } },
  },
});
