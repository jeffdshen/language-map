/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The committed language packs in ../data are served as static files (data/zh-en -> ./zh-en/).
export default defineConfig({
  base: './',
  publicDir: '../data',
  plugins: [react()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
