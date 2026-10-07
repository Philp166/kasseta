import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Сборка в один HTML-файл (всё инлайном): удобно открыть двойным кликом
// через любой статический сервер или залить как единый артефакт.
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    chunkSizeWarningLimit: 8000,
    assetsInlineLimit: 100_000_000,
  },
});
