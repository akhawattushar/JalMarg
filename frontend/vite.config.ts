import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({ plugins: [react(), tailwindcss()], server: { host: true },
  // maplibre-gl v6 loads its worker via import.meta.url; pre-bundling breaks that path in dev
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: { chunkSizeWarningLimit: 1200 },
})
