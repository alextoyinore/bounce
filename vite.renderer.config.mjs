import { defineConfig } from 'vite'

// Vite config for the renderer process
// root points to src/renderer so Vite finds index.html there
export default defineConfig({
  root: 'src/renderer',
  base: './',
  publicDir: 'public'
})
