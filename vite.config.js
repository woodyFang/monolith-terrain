import { defineConfig } from 'vite'

export default defineConfig({
  // relative asset paths so the build works at any URL
  // (GitHub Pages subpath, workers.dev, local file preview)
  base: './',
})
