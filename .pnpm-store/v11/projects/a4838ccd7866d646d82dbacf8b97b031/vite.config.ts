import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative asset URLs let the production bundle run inside Electron's file URL.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
