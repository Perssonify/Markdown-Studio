#!/usr/bin/env node
/**
 * The last step of the declaration build: make dist/**\/*.d.ts loadable by a
 * consumer's TypeScript, whatever its module resolution and `skipLibCheck`.
 *
 * `tsc -p tsconfig.build.json` copies the source's module specifiers into the
 * declarations verbatim, and three kinds only work inside this repo:
 *
 *  - `import "./styles.css";` in dist/index.d.ts. The side-effect import is how
 *    the library build emits dist/styles.css, and TypeScript keeps side-effect
 *    imports in declarations. Since TypeScript 6 turned
 *    `noUncheckedSideEffectImports` on by default, a consumer with
 *    `skipLibCheck: false` got TS2882 (no declaration for a stylesheet) from
 *    OUR file. A stylesheet exports no types, so the line is simply dropped.
 *  - extensionless relative specifiers (`from "./ui/ErrorBoundary"`). Fine for
 *    `moduleResolution: "bundler"`, but this package is `"type": "module"`, so
 *    under `node16`/`nodenext` its declarations are ESM and every one of them
 *    failed with TS2834 — the entry points re-exported nothing and a consumer
 *    saw `has no exported member 'PerssonifyEditor'`. They are rewritten to the
 *    explicit `./x.js` / `./x/index.js` that both resolutions accept.
 *  - the `@/…` path alias (tsconfig `paths`), which no consumer defines. It is
 *    rewritten to the relative path it stands for.
 *
 * `pkg-declarations.test.js` type-checks a consumer against the built dist/
 * under both resolutions, so a new specifier shape fails there, not in a
 * consumer's CI.
 *
 *   node build/finish-declarations.mjs            # rewrites dist/ in place
 *   node build/finish-declarations.mjs --dist out
 *
 * Idempotent: a second run changes nothing.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** `import "x.css";` — a side-effect import of a stylesheet, relative or from a package. */
const STYLESHEET_IMPORT = /^[ \t]*import\s*(["'])[^"'\n]+\.css\1\s*;?[ \t]*(?:\r?\n|$)/gm;

/** A module specifier in `from "…"`, `import "…"` or `import("…")`. */
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|^[ \t]*import\s*)(["'])([^"'\n]+)\2/gm;

const toPosix = (p) => p.split(sep).join("/");

/**
 * Rewrite one declaration file's text.
 *
 * `file` is the declaration's path, `distRoot` the declaration root the `@/`
 * alias maps to, and `isFile(path)` answers whether a path exists as a file
 * (injected so the rewrite itself is pure and testable).
 */
export function finishDeclaration(text, { file, distRoot, isFile }) {
  const dir = dirname(file);
  const withoutStylesheets = text.replace(STYLESHEET_IMPORT, "");
  return withoutStylesheets.replace(SPECIFIER, (whole, lead, quote, spec) => {
    let target;
    if (spec.startsWith("@/")) target = join(distRoot, spec.slice(2));
    else if (spec.startsWith("./") || spec.startsWith("../")) target = join(dir, spec);
    else return whole; // a package: the consumer's resolution handles it
    if (/\.(?:[mc]?js|json)$/.test(spec)) {
      // Already explicit. Only the alias needs work.
      if (!spec.startsWith("@/")) return whole;
      return `${lead}${quote}${relativeSpecifier(dir, target)}${quote}`;
    }
    let resolved;
    if (isFile(`${target}.d.ts`)) resolved = `${target}.js`;
    else if (isFile(join(target, "index.d.ts"))) resolved = join(target, "index.js");
    else return whole; // not ours to guess; the consumer check reports it
    return `${lead}${quote}${relativeSpecifier(dir, resolved)}${quote}`;
  });
}

function relativeSpecifier(fromDir, to) {
  const rel = toPosix(relative(fromDir, to));
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const isFile = (p) => existsSync(p) && statSync(p).isFile();

/**
 * The `types` target of the `./styles.css` export. The README tells consumers
 * to `import "@perssonify/editor/styles.css"`; under TypeScript 6's
 * `noUncheckedSideEffectImports` that import is TS2882 in THEIR file unless
 * something declares it, and a Vite or Next project's `*.css` shim is not a
 * given. A stylesheet has no bindings, so the declaration is empty.
 */
export const STYLESHEET_DECLARATION = "styles.css.d.ts";
const STYLESHEET_DECLARATION_TEXT =
  "// The stylesheet export has no bindings; this lets `import \"@perssonify/editor/styles.css\"` type-check.\nexport {};\n";

/** Rewrite every `.d.ts` under `distRoot` in place. Returns the number changed. */
export function finishDeclarations(distRoot) {
  let changed = 0;
  for (const file of walk(distRoot)) {
    if (!file.endsWith(".d.ts")) continue;
    const text = readFileSync(file, "utf8");
    const next = finishDeclaration(text, { file, distRoot, isFile });
    if (next !== text) {
      writeFileSync(file, next);
      changed++;
    }
  }
  writeFileSync(join(distRoot, STYLESHEET_DECLARATION), STYLESHEET_DECLARATION_TEXT);
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--dist");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dist = resolve(root, i > 0 && process.argv[i + 1] ? process.argv[i + 1] : "dist");
  const n = finishDeclarations(dist);
  console.log(`finish-declarations: rewrote ${n} declaration file(s) in ${relative(root, dist) || "."}/`);
}
