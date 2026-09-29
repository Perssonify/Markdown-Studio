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
      reporter: ['text', 'html', 'json-summary'],
      // ALL of the shipped source. ui/, hooks/ and integration/ used to be left
      // out — the editor shell, Find & Replace, the graph, the cards board, the
      // host bridge — so the number described the half of the code that was
      // easiest to test. Only generated shadcn primitives (regenerated, never
      // hand-edited) and the tests themselves are excluded.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/components/ui/**', 'src/__tests__/**'],
    },
  },
});
