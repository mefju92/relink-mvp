import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
      // potrzebne do /spotify/login i /spotify/callback
      '/spotify': {
        target: 'http://localhost:5174',
        changeOrigin: true,
      },
      // (opcjonalnie) usuń, bo backend używa /api/cloud/*
      // '/cloud': {
      //   target: 'http://localhost:5174',
      //   changeOrigin: true,
      // },
    },
  },
})
