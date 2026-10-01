import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

describe('Test infrastructure', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('has access to jsdom', () => {
    const div = document.createElement('div');
    div.textContent = 'hello';
    expect(div.textContent).toBe('hello');
  });
});

/**
 * Vitest only collects `src/__tests__/**\/*.test.{js,jsx}` (vitest.config.js).
 * A test file written as `.ts` is not an error — it is silently never run, so
 * its assertions look green forever. Fail loudly instead.
 */
describe("the test suite collects every test file it contains", () => {
  it("has no .test.ts / .test.tsx files that vitest would silently ignore", () => {
    const dir = join(process.cwd(), "src/__tests__");
    const stray = readdirSync(dir).filter((f) => /\.test\.tsx?$/.test(f));
    expect(stray).toEqual([]);
  });
});
