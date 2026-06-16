import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

const PORT = Number(process.env.PORT ?? 8787)

// Vite serves the SPA in dev (5173) and proxies /api to the Fastify server.
// In production the Fastify server serves the built client/dist itself.
export default defineConfig({
  root: 'client',
  plugins: [react(), tailwind()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./client/src', import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
