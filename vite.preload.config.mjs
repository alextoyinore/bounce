import { defineConfig } from 'vite'

// Vite config for the Electron preload script
// @electron-forge/plugin-vite handles externals and output paths automatically
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.js'
      }
    }
  }
})
