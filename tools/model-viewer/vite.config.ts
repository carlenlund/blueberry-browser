import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, normalizePath } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const modelsPath = normalizePath(path.resolve(__dirname, '../../resources/models'))

export default defineConfig({
  plugins: [react()],
  define: {
    __MODEL_BASE__: JSON.stringify(`/@fs/${modelsPath}`)
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '../..')]
    }
  }
})
