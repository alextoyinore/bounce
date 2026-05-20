import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Vite config for the renderer process
// root points to src/renderer so Vite finds index.html there
export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: 'public',
  build: {
    outDir: resolve(__dirname, '.vite/renderer/main_window'),
    emptyOutDir: true
  }
})
