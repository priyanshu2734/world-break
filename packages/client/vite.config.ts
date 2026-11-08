import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/socket.io': { target: 'http://localhost:3001', ws: true }, '/auth': { target: 'http://localhost:3001' } },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
