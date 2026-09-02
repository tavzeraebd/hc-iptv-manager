import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Portas padrão do IPTV Manager (o launcher iptv-suite.bat pode sobrescrever
// via env pra rodar Manager e Player lado a lado sem conflito).
const WEB_PORT = Number(process.env.WEB_PORT) || 5173
const API_TARGET = process.env.API_TARGET || 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
  },
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      '/api': API_TARGET,
    },
  },
})
