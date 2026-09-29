import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "../utils/reduced-motion";

/**
 * A096. `styles.css` flattens CSS `scroll-behavior` under
 * prefers-reduced-motion, but that only decides what `behavior: "auto"` means —
 * a script passing `behavior: "smooth"` explicitly animates regardless. The
 * outline / heading jumps and the Help page's section links glided for users
 * who had asked the OS for no motion.
 */

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  else delete window.matchMedia;
});

describe("scrollBehavior", () => {
  it("is instant when the user asks for reduced motion", () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    expect(scrollBehavior()).toBe("auto");
    expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });

  it("is smooth otherwise, and where matchMedia is missing", () => {
    window.matchMedia = vi.fn(() => ({ matches: false }));
    expect(scrollBehavior()).toBe("smooth");
    delete window.matchMedia;
    expect(scrollBehavior()).toBe("smooth");
  });
});

/** Every .ts/.tsx under src, comments stripped, so prose can mention the literal. */
function sources(dir = join(process.cwd(), "src"), out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "__tests__") sources(p, out); continue; }
    if (!/\.(ts|tsx)$/.test(name) || name.endsWith(".d.ts")) continue;
    const code = readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    out.push([p, code]);
  }
  return out;
}

describe("no script hard-codes a smooth scroll", () => {
  it("routes every programmatic scroll behaviour through the helper", () => {
    const all = sources();
    expect(all.length, "the scan found no sources").toBeGreaterThan(50);
    const offenders = all
      .filter(([, code]) => /behavior:\s*["']smooth["']/.test(code))
      .map(([p]) => p.replace(process.cwd(), ""));
    expect(offenders).toEqual([]);
    // …and the known call sites really use it (a scan that matched nothing
    // because the scrolls were deleted would also pass the check above).
    const users = all.filter(([, code]) => code.includes("behavior: scrollBehavior()")).length;
    expect(users).toBeGreaterThanOrEqual(2);
  });
});
