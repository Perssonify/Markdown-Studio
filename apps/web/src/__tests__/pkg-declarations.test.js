// @vitest-environment node
/**
 * The published declarations type-check in a consumer's project (A113).
 *
 * Nothing compiled a consumer against dist/*.d.ts, and three defects hid there:
 *  - dist/index.d.ts kept `import "./styles.css"`. TypeScript 6 turned
 *    `noUncheckedSideEffectImports` on by default, so a consumer with
 *    `skipLibCheck: false` got TS2882 from OUR file;
 *  - `createHostBridge` typed its handle's `setMode`/`setChrome` as taking any
 *    string while the integration's `EditorHandle` takes the literal unions, so
 *    passing the integration's ref type to the bridge was TS2345 — hidden in
 *    the source by an `as any`;
 *  - every relative specifier was extensionless, which `node16`/`nodenext`
 *    reject in an ESM package (TS2834): under those resolutions the entry
 *    points re-exported nothing at all.
 *
 * build/finish-declarations.mjs repairs the emitted files; the rewrite itself
 * is pinned here without a build, and the BUILT check compiles a consumer with
 * `skipLibCheck: false` under both resolutions. Like pkg-cjs-require.test.js,
 * the built check runs when a CURRENT dist/ exists — CI re-runs this file after
 * `bun run build`, and the publish workflow before publishing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { finishDeclaration, STYLESHEET_DECLARATION } from "../../build/finish-declarations.mjs";

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// ── the rewrite, on fixtures ────────────────────────────────────────────────

const DIST = join(ROOT, "fixture-dist");
const FILES = new Set(
  ["index.d.ts", "ui/ErrorBoundary.d.ts", "store/index.d.ts", "components/ui/button.d.ts", "components/ui/dialog.d.ts"].map(
    (f) => join(DIST, f),
  ),
);
const finish = (text, file = "index.d.ts") =>
  finishDeclaration(text, { file: join(DIST, file), distRoot: DIST, isFile: (p) => FILES.has(p) });

describe("finish-declarations — the rewrite", () => {
  it("drops a side-effect stylesheet import, relative or from a package", () => {
    expect(finish('import "./styles.css";\nexport { a } from "x";\n')).toBe('export { a } from "x";\n');
    expect(finish("import 'katex/dist/katex.min.css'\nexport {};\n")).toBe("export {};\n");
  });

  it("keeps an import that merely mentions CSS, and prose about one", () => {
    const text = 'import type { Css } from "./styles.css.types";\n/** Consumers write import "./styles.css" themselves. */\n';
    expect(finish(text)).toBe(text);
  });

  it("makes relative specifiers explicit: a file gets .js, a directory /index.js", () => {
    expect(finish('export { ErrorBoundary } from "./ui/ErrorBoundary";')).toBe(
      'export { ErrorBoundary } from "./ui/ErrorBoundary.js";',
    );
    expect(finish('export * from "./store";')).toBe('export * from "./store/index.js";');
    expect(finish('export type X = import("./store").Doc;')).toBe('export type X = import("./store/index.js").Doc;');
    expect(finish('import { B } from "../ErrorBoundary";', "ui/nested/x.d.ts")).toBe(
      'import { B } from "../ErrorBoundary.js";',
    );
  });

  it("rewrites the @/ alias to the relative path it stands for", () => {
    expect(finish('import { Button } from "@/components/ui/button";', "components/ui/dialog.d.ts")).toBe(
      'import { Button } from "./button.js";',
    );
    expect(finish('import { Button } from "@/components/ui/button";', "index.d.ts")).toBe(
      'import { Button } from "./components/ui/button.js";',
    );
  });

  it("leaves packages, explicit specifiers and unknown targets alone, and is idempotent", () => {
    const text = [
      'import * as React from "react";',
      'import { Node } from "@tiptap/pm/model";',
      'export { x } from "./ui/ErrorBoundary.js";',
      'export { y } from "./not-emitted";',
    ].join("\n");
    expect(finish(text)).toBe(text);
    const once = finish('import "./styles.css";\nexport * from "./store";\n');
    expect(finish(once)).toBe(once);
  });
});

// ── the manifest ────────────────────────────────────────────────────────────

describe("the stylesheet export carries a declaration", () => {
  it("points `types` at the file the post-pass writes, and `default` at the stylesheet", () => {
    expect(pkg.exports["./styles.css"]).toEqual({ types: `./dist/${STYLESHEET_DECLARATION}`, default: "./dist/styles.css" });
  });

  it("runs the post-pass in every script that emits declarations", () => {
    for (const script of ["build", "build:types"]) {
      expect(pkg.scripts[script], script).toMatch(/tsc -p tsconfig\.build\.json && node build\/finish-declarations\.mjs/);
    }
  });
});

// ── the built output ────────────────────────────────────────────────────────

/** Newest modification time among the inputs of the declaration build. */
function newestInput() {
  let newest = 0;
  const visit = (p) => {
    const s = statSync(p);
    if (s.isDirectory()) {
      for (const n of readdirSync(p)) if (n !== "__tests__") visit(join(p, n));
    } else newest = Math.max(newest, s.mtimeMs);
  };
  for (const p of ["src", "build", "package.json", "tsconfig.json", "tsconfig.build.json"]) {
    if (existsSync(join(ROOT, p))) visit(join(ROOT, p));
  }
  return newest;
}

/** True when dist/ holds declarations built from the current inputs. (Only the
 *  entry is dated: a missing stylesheet declaration must FAIL the consumer's
 *  import below, not quietly skip the check.) */
function currentDeclarations() {
  const entry = join(ROOT, "dist", "index.d.ts");
  return existsSync(entry) && statSync(entry).mtimeMs >= newestInput();
}

/** What a consumer writes: every entry point, the stylesheet, and the bridge fed the integration's ref type. */
const CONSUMER = `import { createRef } from "react";
import "@perssonify/editor/styles.css";
import { createHostBridge, PerssonifyEditor, PerssonifyEditorIntegration } from "@perssonify/editor";
import { useMarkdownEngine } from "@perssonify/editor/engine";
import type { EditorChromeLevel, EditorHandle, EditorViewMode } from "@perssonify/editor/integration";
import { createDocument } from "@perssonify/editor/store";

const ref = createRef<EditorHandle>();
createHostBridge(ref, { allowedOrigins: ["https://host.example"] }).destroy();
const mode: EditorViewMode = "split";
const chrome: EditorChromeLevel = "minimal";
ref.current?.setMode(mode);
ref.current?.setChrome(chrome);

export const app = (
  <>
    <PerssonifyEditor />
    <PerssonifyEditorIntegration ref={ref} />
  </>
);
export { createDocument, useMarkdownEngine };
`;

let consumerDir = null;
afterAll(() => {
  if (!consumerDir) return;
  // Unlink the package link FIRST: it points at this repository.
  const link = join(consumerDir, "node_modules", "@perssonify", "editor");
  if (existsSync(link)) unlinkSync(link);
  rmSync(consumerDir, { recursive: true, force: true });
});

/** A consumer project whose `@perssonify/editor` is this package, resolved through its exports map. */
function consumerProject() {
  if (consumerDir) return consumerDir;
  // Under node_modules/ so the consumer's own `react` resolves from this
  // repository; a directory named node_modules is also where Node's
  // self-reference lookup stops, so the package link below is what resolves.
  consumerDir = join(ROOT, "node_modules", ".cache", `pf-consumer-${process.pid}`);
  rmSync(consumerDir, { recursive: true, force: true });
  mkdirSync(join(consumerDir, "node_modules", "@perssonify"), { recursive: true });
  symlinkSync(ROOT, join(consumerDir, "node_modules", "@perssonify", "editor"), "junction");
  writeFileSync(join(consumerDir, "package.json"), JSON.stringify({ name: "pf-consumer", private: true, type: "module" }));
  writeFileSync(join(consumerDir, "consumer.tsx"), CONSUMER);
  return consumerDir;
}

function typeCheck(moduleResolution) {
  const dir = consumerProject();
  const config = join(dir, `tsconfig.${moduleResolution}.json`);
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false, // the point: our declarations are checked too
        target: "es2022",
        lib: ["es2022", "dom", "dom.iterable"],
        module: moduleResolution === "bundler" ? "esnext" : moduleResolution,
        moduleResolution,
        jsx: "react-jsx",
        types: [],
      },
      files: ["consumer.tsx"],
    }),
  );
  // node_modules is hoisted to the monorepo root, two levels above apps/web.
  const tsc = join(ROOT, "..", "..", "node_modules", "typescript", "bin", "tsc");
  const run = spawnSync(process.execPath, [tsc, "-p", config], { cwd: dir, encoding: "utf8", timeout: 120_000 });
  const errors = `${run.stdout}${run.stderr}`.split("\n").filter((l) => /error TS\d+/.test(l));
  return { status: run.status, errors };
}

describe("a consumer compiles against the built declarations with skipLibCheck off (when a current dist/ exists)", () => {
  for (const resolution of ["bundler", "nodenext"]) {
    it(`moduleResolution: ${resolution}`, () => {
      if (!currentDeclarations()) return; // CI re-runs this file after `bun run build`
      const { status, errors } = typeCheck(resolution);
      expect(errors).toEqual([]);
      expect(status).toBe(0);
    }, 120_000);
  }
});
