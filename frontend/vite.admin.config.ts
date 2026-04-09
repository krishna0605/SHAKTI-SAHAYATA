import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const adminSpaRewritePlugin = () => ({
  name: 'admin-spa-rewrite',
  configureServer(server: import('vite').ViteDevServer) {
    server.middlewares.use((req, _res, next) => {
      const url = req.url || '/'
      const accept = req.headers.accept || ''
      const isHtmlRequest = accept.includes('text/html')
      const isInternalAsset =
        url.startsWith('/@') ||
        url.startsWith('/src/') ||
        url.startsWith('/node_modules/') ||
        url.startsWith('/__vite') ||
        url.startsWith('/api') ||
        url.startsWith('/ai') ||
        url.includes('.')

      if (req.method === 'GET' && isHtmlRequest && !isInternalAsset) {
        req.url = '/index.html'
      }

      next()
    })
  },
})

export default defineConfig({
  root: path.resolve(__dirname, 'admin'),
  plugins: [react(), adminSpaRewritePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4174,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ai': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4174,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-admin'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined

          if (id.includes('react') || id.includes('react-router') || id.includes('@tanstack')) {
            return 'vendor-core'
          }

          if (id.includes('recharts') || id.includes('chart.js') || id.includes('react-chartjs-2')) {
            return 'vendor-charts'
          }

          if (id.includes('xlsx') || id.includes('jspdf')) {
            return 'vendor-export'
          }

          if (id.includes('vis-network') || id.includes('vis-data') || id.includes('leaflet')) {
            return 'vendor-graph'
          }

          return 'vendor-misc'
        },
      },
    },
  },
})
