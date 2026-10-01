// @vitest-environment node
/**
 * The CommonJS build can be `require`d (A113).
 *
 * `require("@perssonify/editor")` threw `U.default.configure is not a
 * function` in plain Node, and nothing noticed: the e2e library suite mounts
 * the ES build, and no test loaded dist/*.cjs at all.
 *
 * The cause is Rolldown's CommonJS interop. This package is `"type": "module"`,
 * so its source is ESM in Node's sense, and a default import from a CommonJS
 * module gets NODE's semantics: `default` is the whole `module.exports`. In the
 * CJS build every external import becomes a `require()` of that package's own
 * CJS file — and a package compiled from ESM (every `@tiptap/*` one) marks that
 * file `__esModule` and keeps its real default export at `exports.default`. So
 * `import StarterKit from "@tiptap/starter-kit"` handed the CJS build the
 * module object `{ StarterKit, default }`, whose `.configure` does not exist.
 * The ES build was never affected: there the import stays an `import`.
 *
 * Two layers, because they fail at different times:
 *  - the SOURCE rule runs with the unit suite, needs no build, and names the
 *    offending import: no default import from an external package whose CJS
 *    entry is `__esModule` (import the named export instead);
 *  - the BUILT check requires every CJS entry, through the package's own
 *    exports map, in a separate Node process, and compares what each exposes
 *    with its ES twin. It runs when a CURRENT dist/ exists — CI re-runs this
 *    file after `bun run build`, and the publish workflow before publishing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const requireFromRoot = createRequire(join(ROOT, "package.json"));

/** The library's own source: everything the library build can reach. */
const APP_ONLY = new Set(["src/main.tsx", "src/embed.tsx"]);
function sourceFiles(dir = join(ROOT, "src")) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "__tests__") out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      const rel = relative(ROOT, full).split(sep).join("/");
      if (!APP_ONLY.has(rel)) out.push({ rel, full });
    }
  }
  return out;
}

const EXTERNAL = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})]);
const packageOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

/** `import Name from "x"` and `import Name, { … } from "x"` — a default binding. */
const DEFAULT_IMPORT = /^import\s+(?!type\b)([A-Za-z_$][\w$]*)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+)\s*)?from\s+["']([^"']+)["']/gm;

describe("the source never default-imports an __esModule CommonJS external", () => {
  it("the rule applies: the package is ESM, so Rolldown gives its imports Node's interop", () => {
    // If this ever changes, the rule below stops being necessary — and the
    // built check still stands.
    expect(pkg.type).toBe("module");
  });

  it("imports the named export instead (e.g. `{ StarterKit }`)", () => {
    const offenders = [];
    for (const { rel, full } of sourceFiles()) {
      const text = readFileSync(full, "utf8");
      for (const [, binding, spec] of text.matchAll(DEFAULT_IMPORT)) {
        if (!EXTERNAL.has(packageOf(spec))) continue;
        let exported;
        try {
          exported = requireFromRoot(spec);
        } catch {
          continue; // not loadable as CommonJS at all: the built check reports it
        }
        if (exported && exported.__esModule && "default" in exported && exported.default !== exported) {
          offenders.push(`${rel}: import ${binding} from "${spec}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── the built output ────────────────────────────────────────────────────────

const ENTRIES = { ".": "index", "./engine": "engine", "./store": "store", "./integration": "integration" };

/** Newest modification time among the inputs of the library build. */
function newestInput() {
  let newest = 0;
  const visit = (p) => {
    const s = statSync(p);
    if (s.isDirectory()) {
      for (const n of readdirSync(p)) if (n !== "__tests__") visit(join(p, n));
    } else newest = Math.max(newest, s.mtimeMs);
  };
  for (const p of ["src", "build", "package.json", "vite.config.ts"]) if (existsSync(join(ROOT, p))) visit(join(ROOT, p));
  return newest;
}

/** A dist/ built from the current inputs, or null (CI re-runs this file after the build). */
function currentDist() {
  const cjs = Object.values(ENTRIES).map((e) => join(ROOT, "dist", `${e}.cjs`));
  if (!cjs.every(existsSync)) return null;
  const oldest = Math.min(...cjs.map((p) => statSync(p).mtimeMs));
  return oldest >= newestInput() ? cjs : null;
}

/** Export names of an ES entry, read from its closing `export { … }`. */
function esExportNames(file) {
  const text = readFileSync(file, "utf8");
  const clauses = [...text.matchAll(/export\s*\{([^}]*)\}/g)].map((m) => m[1]);
  return clauses
    .flatMap((c) => c.split(","))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+as\s+/).pop().trim())
    .sort();
}

describe("the built CommonJS entries load in plain Node (checked when a current dist/ exists)", () => {
  it("every exports-map `require` target loads, and exposes what its ES twin exports", () => {
    if (!currentDist()) return; // CI re-runs this file after `bun run build`
    const MARK = "@@pf-cjs-result@@";
    // A separate process: vitest's own module system is not what a consumer's
    // `require` goes through. The package's own name resolves through its
    // exports map (Node supports self-reference), so the map is checked too.
    const script = `
      const out = {};
      for (const sub of ${JSON.stringify(Object.keys(ENTRIES))}) {
        const id = ${JSON.stringify(pkg.name)} + sub.slice(1);
        try { out[sub] = { keys: Object.keys(require(id)).sort() }; }
        catch (e) { out[sub] = { error: String(e && e.message).split("\\n")[0] }; }
      }
      process.stdout.write("\\n${MARK}" + JSON.stringify(out));
    `;
    const run = spawnSync(process.execPath, ["-e", script], { cwd: ROOT, encoding: "utf8", timeout: 60_000 });
    expect(run.status, run.stderr).toBe(0);
    const result = JSON.parse(run.stdout.slice(run.stdout.lastIndexOf(MARK) + MARK.length));

    for (const [sub, entry] of Object.entries(ENTRIES)) {
      expect(result[sub].error, `require("${pkg.name}${sub.slice(1)}")`).toBeUndefined();
      const names = esExportNames(join(ROOT, "dist", `${entry}.js`));
      expect(names.length, `${entry}.js exports`).toBeGreaterThan(0);
      expect(result[sub].keys, `dist/${entry}.cjs vs dist/${entry}.js`).toEqual(names);
    }
  });
});
