import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Pełny plik: proxy kieruje /api/* oraz /cloud/* do backendu na :5174
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
      '/cloud': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
    },
  },
})
