/**
 * The eager vendor chunks may only hold what the entry needs synchronously.
 *
 * Every named chunk from vite.chunks.ts is modulepreloaded by index.html. The
 * old strategy put every node_modules package not on a hand-written exclusion
 * list into `vendor`, so mammoth, @zip.js and Mermaid's layout libraries — all
 * reached only through `await import()` — shipped in the startup bundle anyway
 * (a 976 KB eagerly preloaded chunk). These cases drive the strategy against a
 * small module graph shaped like the real one.
 */
import { describe, expect, it } from "vitest";
import { createManualChunks } from "../../vite.chunks.ts";

const NM = "/repo/node_modules";

/** A module graph in the shape Rolldown's getModuleInfo reports. */
function graph(defs) {
  const mods = new Map();
  for (const [id, def] of Object.entries(defs)) {
    mods.set(id, { isEntry: !!def.entry, importedIds: def.imports ?? [], importers: [] });
  }
  for (const [id, info] of mods) {
    for (const dep of info.importedIds) mods.get(dep)?.importers.push(id);
  }
  const getModuleInfo = (id) => mods.get(id) ?? null;
  return (chunks, id) => chunks(id, { getModuleInfo });
}

// main.tsx statically imports React, CodeMirror, a UI lib and a shared helper,
// and DYNAMICALLY imports docx-import.ts (so that edge is not in `imports`).
const APP = {
  "/repo/src/main.tsx": {
    entry: true,
    imports: [`${NM}/react/index.js`, `${NM}/@codemirror/view/dist/index.js`, `${NM}/eager-lib/index.js`, `${NM}/shared-lib/index.js`, `${NM}/sonner/dist/index.mjs`],
  },
  "/repo/src/store/docx-import.ts": {
    imports: [`${NM}/mammoth/lib/index.js`, `${NM}/shared-lib/index.js`, `${NM}/@codemirror/lang-rust/dist/index.js`],
  },
  [`${NM}/react/index.js`]: {},
  [`${NM}/@codemirror/view/dist/index.js`]: {},
  [`${NM}/eager-lib/index.js`]: {},
  [`${NM}/shared-lib/index.js`]: {},
  [`${NM}/sonner/dist/index.mjs`]: { imports: [`${NM}/react/index.js`] },
  // Lazy-only: mammoth's tree, including a module that imports React core and
  // two modules that import each other.
  [`${NM}/mammoth/lib/index.js`]: { imports: [`${NM}/jszip/lib/index.js`, `${NM}/lazy-react-widget/index.js`, `${NM}/cycle-a/index.js`] },
  [`${NM}/jszip/lib/index.js`]: {},
  [`${NM}/lazy-react-widget/index.js`]: { imports: [`${NM}/react/index.js`] },
  [`${NM}/cycle-a/index.js`]: { imports: [`${NM}/cycle-b/index.js`] },
  [`${NM}/cycle-b/index.js`]: { imports: [`${NM}/cycle-a/index.js`] },
  [`${NM}/@codemirror/lang-rust/dist/index.js`]: {},
};

describe("manualChunks — only statically reachable packages are grouped", () => {
  it("keeps packages reached only through a dynamic import OUT of every eager chunk", () => {
    const ask = graph(APP);
    const chunks = createManualChunks();
    for (const lazy of [
      `${NM}/mammoth/lib/index.js`,
      `${NM}/jszip/lib/index.js`,
      `${NM}/cycle-a/index.js`,
      `${NM}/cycle-b/index.js`,
    ]) {
      expect(ask(chunks, lazy), lazy).toBeUndefined();
    }
    // A lazy module that imports React used to be pulled into react-vendor,
    // and a lazy CodeMirror language into the eager codemirror chunk.
    expect(ask(chunks, `${NM}/lazy-react-widget/index.js`)).toBeUndefined();
    expect(ask(chunks, `${NM}/@codemirror/lang-rust/dist/index.js`)).toBeUndefined();
  });

  it("still groups what the entry needs synchronously", () => {
    const ask = graph(APP);
    const chunks = createManualChunks();
    expect(ask(chunks, `${NM}/eager-lib/index.js`)).toBe("vendor");
    expect(ask(chunks, `${NM}/react/index.js`)).toBe("react-vendor");
    expect(ask(chunks, `${NM}/@codemirror/view/dist/index.js`)).toBe("codemirror");
    expect(ask(chunks, `${NM}/sonner/dist/index.mjs`)).toBe("ui");
    // Used lazily too, but the entry imports it statically: it is eager anyway.
    expect(ask(chunks, `${NM}/shared-lib/index.js`)).toBe("vendor");
  });

  it("ignores first-party modules", () => {
    const chunks = createManualChunks();
    expect(graph(APP)(chunks, "/repo/src/store/docx-import.ts")).toBeUndefined();
  });

  it("answers from the CURRENT graph when a module is asked about again (a new build)", () => {
    const chunks = createManualChunks();
    const lazyId = `${NM}/jszip/lib/index.js`;
    expect(graph(APP)(chunks, lazyId)).toBeUndefined();
    // Second build: the entry now imports jszip statically.
    const rebuilt = {
      ...APP,
      "/repo/src/main.tsx": { ...APP["/repo/src/main.tsx"], imports: [...APP["/repo/src/main.tsx"].imports, lazyId] },
    };
    expect(graph(rebuilt)(chunks, lazyId)).toBe("vendor");
  });
});
