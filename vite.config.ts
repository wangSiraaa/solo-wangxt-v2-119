import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          // three 体积较大，独立分块；xatlas 由动态 import 自动切分按需加载
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
