import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards that the PORTABLE MODULE stays current with the user-facing editor.
 *
 * The library/embed surface has drifted from the app before: `fitParent` existed
 * on PerssonifyEditor for months while `PerssonifyEditorIntegration` never
 * forwarded it, so an embedder mounting the editor into a fixed-size container
 * (a dashboard tile, an in-scene panel in a Three.js app) silently got a
 * viewport-height editor that overflowed its box.
 *
 * These are deliberately static source assertions rather than render tests: the
 * failure mode is "a prop was added to one file and not the other", which no
 * runtime test of the current props would ever catch.
 */

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

const PE = read("src/PerssonifyEditor.tsx");
const INTEGRATION = read("src/integration/PerssonifyEditorIntegration.tsx");
const PKG = JSON.parse(read("package.json"));

/**
 * Props an embedder must be able to control. Standalone-app-only hooks
 * (onAbout/onHelp/onStartTour/graphOpen/onGraphOpenChange) are intentionally
 * NOT forwarded — the embed keeps its built-in dialogs and internal toggles.
 */
const EMBEDDER_PROPS = [
  "storageAdapter",
  "storageConfig",
  "onStorageMetricsChange",
  "onStorageQuotaExceeded",
  "onContentChange",
  "onSave",
  "initialMode",
  "chrome",
  "initialDocument",
  "fitParent",
];

describe("integration wrapper parity with PerssonifyEditor", () => {
  it.each(EMBEDDER_PROPS)("declares `%s` in its public props", (prop) => {
    expect(INTEGRATION).toMatch(new RegExp(`\\b${prop}\\??:`));
  });

  it.each(EMBEDDER_PROPS)("forwards `%s` down to PerssonifyEditor", (prop) => {
    // Either `prop={prop}` or `prop={(...) => ...}` wrapping the callback.
    expect(INTEGRATION).toMatch(new RegExp(`${prop}=\\{`));
  });

  it("keeps fitParent meaningful in PerssonifyEditor (drives h-full vs h-dvh)", () => {
    // If this stops being true, forwarding fitParent no longer sizes anything.
    expect(PE).toMatch(/fitParent \? "h-full" : "h-dvh"/);
  });
});

describe("published package surface", () => {
  it("ships TypeScript types", () => {
    expect(PKG.types).toBeTruthy();
    expect(PKG.exports["."].types).toBeTruthy();
  });

  it("declares a types condition on every code subpath export", () => {
    for (const [sub, entry] of Object.entries(PKG.exports)) {
      if (typeof entry === "string") continue; // a plain asset path, if one is ever added
      expect(entry.types, `${sub} is missing a types condition`).toBeTruthy();
    }
  });

  it("exports the stylesheet the library build actually emits", () => {
    // The export used to point at dist/styles.css while the lib build emitted
    // no CSS at all — consumers rendered completely unstyled.
    // An object since the stylesheet gained a `types` target (pkg-declarations.test.js).
    expect(PKG.exports["./styles.css"].default).toBe("./dist/styles.css");
    const viteConfig = read("vite.config.ts");
    expect(viteConfig).toMatch(/cssFileName:\s*['"]styles['"]/);
    // ...and something in the entry chain must import it, or nothing is emitted.
    expect(read("src/index.tsx")).toMatch(/import\s+["']\.\/styles\.css["']/);
  });

  it("marks CSS as a side effect so bundlers don't tree-shake it away", () => {
    expect(PKG.sideEffects).toBeTruthy();
    expect(JSON.stringify(PKG.sideEffects)).toContain("css");
  });

  it("restricts published files", () => {
    expect(PKG.files).toContain("dist");
  });

  it("builds types as part of the library build", () => {
    expect(PKG.scripts.build).toContain("tsconfig.build.json");
  });

  it("declares every runtime-external dep as a peer dependency", async () => {
    // next-themes was externalized in vite.config.ts but only listed under
    // devDependencies, so consumers hit an unresolved import at runtime. The
    // externals are now DERIVED from the manifest (build/externals.mjs), so
    // being external and being declared are one fact; this checks both halves
    // through the helper the build uses rather than grepping the config.
    const { libraryExternals } = await import("../../build/externals.mjs");
    const externals = libraryExternals(PKG);
    for (const dep of ["next-themes", "zustand", "lucide-react"]) {
      expect(externals.some((re) => re.test(dep)), `${dep} must be external`).toBe(true);
      expect(PKG.peerDependencies[dep], `${dep} must be a peerDependency`).toBeTruthy();
    }
  });
});
