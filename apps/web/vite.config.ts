import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1400,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('/antd/') || id.includes('@ant-design') || id.includes('/rc-') || id.includes('@rc-component')) return 'antd';
    } } },
  },
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787', '/health': 'http://127.0.0.1:8787' } },
});
