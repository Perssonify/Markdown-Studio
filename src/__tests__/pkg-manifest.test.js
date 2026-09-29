import { readdirSync, readFileSync } from "fs";
import { builtinModules } from "module";
import { join, relative, sep } from "path";
import { describe, expect, it } from "vitest";

/**
 * The published manifest is a contract with every consumer, and it drifted in
 * ways only a fresh install outside this repo could see:
 *
 *  - the built library imported `@tiptap/extension-list`, `prosemirror-model`
 *    and `prosemirror-state` without declaring any of them, and bundled an
 *    undeclared `nanoid` — Bun's lockfile happened to resolve them all;
 *  - `vaul`, `@floating-ui/dom` and `@fontsource/geist-sans` were runtime
 *    dependencies nothing imported, installed into every consumer's tree;
 *  - peer ranges were open-ended (`>=3`, `>=6`, `>=18`), so a future breaking
 *    major "satisfied" them;
 *  - the Tiptap packages sat at three different versions, and a plain
 *    `npm install` failed with ERESOLVE, because every Tiptap package peers on
 *    its siblings at the EXACT same version.
 *
 * These read package.json and the source, so they need no build and no network.
 */
const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const deps = pkg.dependencies ?? {};
const dev = pkg.devDependencies ?? {};
const peers = pkg.peerDependencies ?? {};

/** Dev-only packages the LIBRARY bundles on purpose (see vite.config.ts). */
const BUNDLED = ["@base-ui/react", "sonner"];
/** Entry points that belong to the standalone app / iframe embed, not the library. */
const APP_ONLY = ["src/main.tsx", "src/embed.tsx"];

// ── a minimal semver, enough for the range shapes this manifest uses ─────────
const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? m.slice(1, 4).map(Number) : null;
};
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
function satisfiesOne(version, range) {
  const r = range.trim();
  const v = parse(version);
  if (r.startsWith("^") || r.startsWith("~")) {
    const lo = parse(r.slice(1));
    if (cmp(v, lo) < 0) return false;
    if (r[0] === "~") return v[0] === lo[0] && v[1] === lo[1];
    if (lo[0] > 0) return v[0] === lo[0];
    if (lo[1] > 0) return v[0] === 0 && v[1] === lo[1];
    return v[0] === 0 && v[1] === 0 && v[2] === lo[2];
  }
  return cmp(v, parse(r)) === 0;
}
const satisfies = (version, range) => range.split("||").some((r) => satisfiesOne(version, r));

// ── what the code actually imports ───────────────────────────────────────────
const NODE_BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
const packageOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

/** Static imports/re-exports anchored at a line start (multi-line braces
 *  included), side-effect imports, and dynamic `import("…")`. Anchoring keeps
 *  code SAMPLES in strings and the word "import" in prose out of it. */
function specifiersIn(src) {
  const out = [];
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const m of code.matchAll(/^\s*(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of code.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function importsUnder(dir, { exclude = [] } = {}) {
  const found = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = relative(ROOT, p).split(sep).join("/");
      if (e.isDirectory()) {
        if (e.name !== "__tests__" && e.name !== "node_modules") walk(p);
        continue;
      }
      if (!/\.(m?[jt]sx?)$/.test(e.name) || exclude.includes(rel)) continue;
      for (const spec of specifiersIn(readFileSync(p, "utf8"))) {
        if (spec.startsWith(".") || spec.startsWith("@/") || NODE_BUILTINS.has(spec)) continue;
        const name = packageOf(spec);
        if (name === pkg.name) continue; // the package's own public name, in a doc sample
        if (!found.has(name)) found.set(name, new Set());
        found.get(name).add(rel);
      }
    }
  };
  walk(join(ROOT, dir));
  return found;
}

const report = (map) => [...map].map(([name, files]) => `${name} (${[...files].join(", ")})`);

describe("package manifest — every import is declared", () => {
  it("declares every package the source, the relay and the build helpers import", () => {
    const declared = new Set([...Object.keys(deps), ...Object.keys(dev), ...Object.keys(peers)]);
    const undeclared = new Map();
    for (const dir of ["src", "api", "build"]) {
      for (const [name, files] of importsUnder(dir)) if (!declared.has(name)) undeclared.set(name, files);
    }
    expect(report(undeclared)).toEqual([]);
  });

  it("gives consumers everything the library imports: a dependency, a peer, or a package it bundles", () => {
    const shipped = new Set([...Object.keys(deps), ...Object.keys(peers), ...BUNDLED]);
    const missing = new Map();
    for (const [name, files] of importsUnder("src", { exclude: APP_ONLY })) {
      if (!shipped.has(name)) missing.set(name, files);
    }
    expect(report(missing)).toEqual([]);
  });

  it("keeps the bundled packages out of `dependencies` so consumers do not install a second copy", () => {
    for (const name of BUNDLED) {
      expect(dev[name], `${name} must be a devDependency`).toBeTruthy();
      expect(deps[name], `${name} is bundled, so it must not also be a dependency`).toBeUndefined();
      expect(peers[name], `${name} is bundled, so it must not also be a peer`).toBeUndefined();
    }
  });

  it("installs the import relay's runtime import as a runtime dependency", () => {
    // api/import.js runs on Vercel; a devDependency is not a runtime contract.
    for (const name of importsUnder("api").keys()) expect(deps[name], name).toBeTruthy();
  });

  it("declares no runtime dependency that nothing imports", () => {
    const used = new Set([...importsUnder("src").keys(), ...importsUnder("api").keys()]);
    expect(Object.keys(deps).filter((name) => !used.has(name))).toEqual([]);
  });
});

describe("package manifest — ranges", () => {
  it("bounds every peer range from above", () => {
    const open = Object.entries(peers).filter(([, range]) =>
      range.split("||").some((r) => {
        const t = r.trim();
        return t === "*" || t === "latest" || /x/i.test(t) || (/^>/.test(t) && !/</.test(t));
      }),
    );
    expect(open).toEqual([]);
  });

  it("develops against a version each peer range accepts", () => {
    const bad = [];
    for (const [name, range] of Object.entries(peers)) {
      const spec = dev[name];
      if (!spec) { bad.push(`${name}: not a devDependency`); continue; }
      const floor = spec.replace(/^[\^~]/, "");
      if (!satisfies(floor, range)) bad.push(`${name}: dev ${spec} is outside peer ${range}`);
    }
    expect(bad).toEqual([]);
  });

  it("moves the Tiptap packages as ONE set — each peers on its siblings at the exact same version", () => {
    const tiptapDev = Object.entries(dev).filter(([n]) => n.startsWith("@tiptap/"));
    const versions = new Set(tiptapDev.map(([, v]) => v));
    expect([...versions]).toHaveLength(1);
    const [version] = versions;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [name, range] of Object.entries(peers)) {
      if (name.startsWith("@tiptap/")) expect(range, name).toBe(`^${version}`);
    }
    // A Tiptap package in `dependencies` gets its own @tiptap/core resolution
    // in a consumer's tree — exactly the mismatch npm refuses with ERESOLVE.
    expect(Object.keys(deps).filter((n) => n.startsWith("@tiptap/"))).toEqual([]);
  });

  it("types React at the major it runs on", () => {
    const major = (spec) => parse(spec.replace(/^[\^~]/, ""))[0];
    expect(major(dev["@types/react"])).toBe(major(dev.react));
    expect(major(dev["@types/react-dom"])).toBe(major(dev["react-dom"]));
  });

  it("never overrides a direct dependency with a different spec (npm refuses: EOVERRIDE)", () => {
    const direct = { ...deps, ...dev };
    const conflicts = Object.entries(pkg.overrides ?? {})
      .filter(([name, spec]) => name in direct && direct[name] !== spec)
      .map(([name, spec]) => `${name}: override ${spec} vs direct ${direct[name]}`);
    expect(conflicts).toEqual([]);
  });

  it("pins the package manager that owns the lockfile", () => {
    expect(pkg.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
  });
});
