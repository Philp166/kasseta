import { defineConfig } from 'vite';

// Обычная сборка: dist/ с отдельными файлами (для dev-сервера и хостинга).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
