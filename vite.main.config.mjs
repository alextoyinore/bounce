import { defineConfig } from 'vite'

// Vite config for the Electron main process
// @electron-forge/plugin-vite handles externals and output paths automatically
export default defineConfig({
  build: {
    rollupOptions: {
      // Mark native node modules as external (they can't be bundled)
      external: ['electron'],
      output: {
        entryFileNames: 'main.js'
      }
    }
  }
})
