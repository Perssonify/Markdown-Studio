// ESLint (flat config). `bun run lint` must report ZERO errors; warnings are the
// backlog, counted, not ignored.
//
// Correctness in this codebase rests on the React hook rules more than anything
// a linter usually guards: the sync engine's `force*` callbacks keep EMPTY
// dependency arrays on purpose, and a memoised handler that quietly lost a
// dependency once killed every keyboard shortcut (CLAUDE.md, "An effect that
// needs a mounted DOM node…"). So `rules-of-hooks` is an error and
// `exhaustive-deps` is on as a warning — a deliberate omission is spelled out
// with an `eslint-disable-next-line` and a comment saying why, exactly as the
// existing ones do.
//
// Everything else is the stock `@eslint/js` + `typescript-eslint` recommended
// set. Where a rule is loosened below, the reason is next to it — none of them
// is loosened to hide a finding in code this config's author did not own.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "dist/", "dist-app/", "dist-embed/", "coverage/", "public/", "marketing/",
    ".e2e-host-*/", ".e2e-bridge-*/",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts}"],
    languageOptions: {
      // src/ is browser code, api/ build/ e2e/ scripts/ and the configs are
      // Node; the two sets do not collide, so one list serves both.
      globals: { ...globals.browser, ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ~200 `any`s, most of them in the public integration API (EditorHandle,
      // the host bridge) and in ProseMirror/Tiptap JSON plumbing. Replacing them
      // is a typing project (see the noImplicitAny note in the G6 report), not a
      // lint fix — so they are counted as warnings until it is done.
      "@typescript-eslint/no-explicit-any": "warn",

      // For .ts/.tsx the type gate already enforces this (tsconfig
      // noUnusedLocals / noUnusedParameters, which also exempt `_`-prefixed
      // names — mirrored here). What it adds is the .js test and e2e scripts,
      // where a leftover is untidy rather than wrong. Unused catch bindings are
      // idiomatic.
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
        caughtErrors: "none",
      }],

      // `cond ? add() : remove()` and `a && b()` as statements are house style
      // (the Set toggles in WorkspacePanel / UrlImportDialog).
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],

      // `try { … } catch {}` is used deliberately for best-effort feature
      // detection (e.g. RegExp `d` flag support) and optional cleanup.
      "no-empty": ["error", { allowEmptyCatch: true }],

      // The URL and ingest sanitizers match control characters ON PURPOSE —
      // that is what they strip (src/utils/url-safety.ts).
      "no-control-regex": "off",

      // Real but low-risk findings — dead stores, redundant escapes, `let` that
      // could be `const` — in files owned by other work streams at the time
      // this config landed. Warnings until their owners fix them; listed in the
      // G6 report.
      "no-useless-assignment": "warn",
      "no-useless-escape": "warn",
      "prefer-const": "warn",
    },
  },
  {
    // vitest runs tests as ESM in Node, where `require` also exists; a few
    // tests use it to reach CommonJS helpers synchronously.
    files: ["src/__tests__/**"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);
