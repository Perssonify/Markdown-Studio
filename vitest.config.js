import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [ tailwindcss(),react()],
  resolve: {
    // Mirror the app's "@/…" → src alias so tests can import components.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/engine/**', 'src/store/**', 'src/formatting/**', 'src/extensions/**'],
      exclude: ['src/**/*.d.ts', 'src/components/ui/**'],
    },
  },
});
