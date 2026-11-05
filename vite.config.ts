import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs so the renderer works under Electron file://
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
})
