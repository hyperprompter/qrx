/**
 * servers/reddit/vite.server.config.js
 *
 * Builds servers/reddit/server.ts → dist/server/index.cjs
 * Devvit requires a single CJS bundle; no externals (bundle everything in).
 */

import { defineConfig } from 'vite'
import { builtinModules } from 'node:module'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '../..')

export default defineConfig({
  ssr: {
    noExternal: true,
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
  },
  build: {
    ssr: resolve(__dirname, 'server.ts'),
    outDir: resolve(ROOT, 'dist/server'),
    emptyOutDir: true,
    target: 'node22',
    sourcemap: false,
    commonjsOptions: {
      ignoreDynamicRequires: true,
    },
    rollupOptions: {
      external: [...builtinModules],
      output: {
        format: 'cjs',
        entryFileNames: 'index.cjs',
        inlineDynamicImports: true,
      },
    },
  },
})