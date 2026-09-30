import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // xatlas-wasm ships a single self-contained ESM with the wasm embedded;
  // give it room so the optimizer does not choke on the binary string.
  build: {
    chunkSizeWarningLimit: 1500,
  },
  optimizeDeps: {
    exclude: ['xatlas-wasm'],
  },
});
