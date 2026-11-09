import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const SERVER = `http://localhost:${process.env.PORT || 3123}`;

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: { '/api': SERVER, '/media': SERVER, '/vendor': SERVER, '/characters': SERVER },
  },
  build: { outDir: path.resolve(__dirname, 'dist'), emptyOutDir: true },
});
