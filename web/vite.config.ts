import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
      '/api': 'http://127.0.0.1:8080',
      '/api/realtime': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // 代码分割：vendor 和页面 chunks 分离
    rollupOptions: {
      output: {
        // 将 React 和路由等第三方库拆成独立 chunk
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query'],
          motion: ['framer-motion'],
          icons: ['lucide-react'],
        },
      },
    },
    // 生成 source map 便于调试
    sourcemap: false, // 生产环境关闭
    // CSS 代码分割
    cssCodeSplit: true,
    // 压缩：esbuild minify 时 terserOptions 是 no-op，用 esbuild 自己的 drop
    minify: 'esbuild',
    esbuild: {
      drop: ['console', 'debugger'],
    },
  },
  // 优化依赖预构建
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'],
  },
})
