import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * Packages that must resolve to exactly ONE copy in bun.lock.
 *
 * ProseMirror compares node and mark types by identity: two copies of
 * prosemirror-model in one bundle is the classic "looks like multiple versions
 * of prosemirror-model were loaded" breakage, and schema/instanceof checks fail
 * silently before that. Bun's incremental resolve LEFT such copies behind when
 * the Tiptap set moved to 3.31.3 — prosemirror-state, -commands, -tables … each
 * kept a nested prosemirror-model@1.25.4 beside the hoisted 1.25.12 — and the
 * suite stayed green, because jsdom never loaded the nested copies through the
 * paths that compare them. KaTeX: mermaid pins katex ^0.16, so without the
 * `overrides` entry the app shipped two KaTeX builds (measured: two katex-*.js
 * chunks in dist-app/).
 *
 * A nested lockfile key (`parent/pkg`) is a second resolution of `pkg`.
 */
const SINGLETONS = [
  "@tiptap/core",
  "@tiptap/pm",
  "prosemirror-model",
  "prosemirror-state",
  "prosemirror-transform",
  "prosemirror-view",
  "react",
  "react-dom",
  "katex",
];

/** `mermaid/katex` → katex, `@types/react` → @types/react (scoped names are two segments). */
function packageOfKey(key) {
  const parts = key.split("/");
  const names = [];
  for (let i = 0; i < parts.length; i++) {
    names.push(parts[i].startsWith("@") ? `${parts[i]}/${parts[++i]}` : parts[i]);
  }
  return names.at(-1);
}

function lockedPackages() {
  // bun.lock is JSONC with trailing commas.
  // One lockfile for the whole monorepo, at its root (the frontend is apps/web).
  const text = readFileSync(join(process.cwd(), "..", "..", "bun.lock"), "utf8").replace(/,(\s*[}\]])/g, "$1");
  return Object.entries(JSON.parse(text).packages).map(([key, [spec]]) => ({ key, spec, name: packageOfKey(key) }));
}

describe("bun.lock — one copy of the packages that must not be duplicated", () => {
  const entries = lockedPackages();
  const resolutionsOf = (pkg) =>
    entries.filter(({ name }) => name === pkg).map(({ key, spec }) => `${key} → ${spec}`);

  for (const pkg of SINGLETONS) {
    it(`resolves ${pkg} once`, () => {
      expect(resolutionsOf(pkg)).toHaveLength(1);
    });
  }

  it("resolves every @tiptap package to the same version", () => {
    const versions = new Set(
      entries.filter(({ spec }) => spec.startsWith("@tiptap/")).map(({ spec }) => spec.slice(spec.lastIndexOf("@") + 1)),
    );
    expect([...versions]).toHaveLength(1);
  });
});
