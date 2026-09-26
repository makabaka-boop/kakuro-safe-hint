import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Served by the compose-provided nginx image in production; relative
  // asset paths keep the build portable behind any route prefix.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Full enumeration on small boards must be quick; 10s is a hard guard.
    testTimeout: 10000
  }
});
