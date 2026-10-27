import { defineConfig } from 'vite';

// Relative base so the build works from any path (e.g. GitHub Pages /QuickShuffle/).
export default defineConfig({
  base: './',
  server: { host: true },
});
