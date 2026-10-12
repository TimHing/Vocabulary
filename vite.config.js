import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  base: './', // 相對路徑：同一份 build 可直接部署到 GitHub Pages（子路徑）與 Firebase Hosting（根路徑）
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
  },
  test: {
    include: ['tests/**/*.test.js'],
  },
});
