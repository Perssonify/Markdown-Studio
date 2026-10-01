import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Synthesizing the stack bundles assets and takes a few seconds.
    testTimeout: 60_000,
  },
});
