import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

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
  build: {
    outDir: 'dist',
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
