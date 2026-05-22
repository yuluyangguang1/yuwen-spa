import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8081',
      '/api/realtime': {
        target: 'ws://127.0.0.1:8081',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
