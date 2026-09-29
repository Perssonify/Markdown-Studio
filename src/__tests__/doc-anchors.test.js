import { spawnSync } from "child_process";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { anchorsIn, audit, defineLine } from "../../scripts/doc-anchors.mjs";

/**
 * The docs link into the source with `#L123` anchors. A line number is the most
 * useful and the most perishable thing a document can carry: every insertion
 * above it moves it, silently, and a reader who follows one lands in an
 * unrelated function and concludes the document is wrong about more than the
 * number. Measured before this gate existed, 72 of 171 anchors had drifted off
 * their subject — the docs had rotted quietly across many releases.
 *
 * The contract this pins: an anchor must land within a few lines of a symbol the
 * sentence names in backticks, and a symbol that is only MENTIONED in the target
 * file (rather than defined there) does not get a line number at all — an
 * arbitrary "first occurrence" is false precision, which is worse than the stale
 * number it would replace.
 */

describe("documentation anchors", () => {
  const result = audit();

  it("checks a meaningful number of them", () => {
    expect(result.total).toBeGreaterThan(100);
  });

  it("all point at files that exist", () => {
    expect(result.missing.map((m) => `${m.doc}:${m.row} → ${m.file}`)).toEqual([]);
  });

  it("all name a symbol that is actually in the file they point at", () => {
    expect(
      result.unresolved.map((u) => `${u.doc}:${u.row} → none of ${u.idents.join(", ")} in ${u.file}`)
    ).toEqual([]);
  });

  it("none has drifted off its symbol", () => {
    expect(
      result.drift.map((d) => `${d.doc}:${d.row} → ${d.file}#L${d.line} (${d.ident} is at L${d.should})`)
    ).toEqual([]);
  });
});

describe("the checker itself", () => {
  it("credits an anchor to the identifiers before it, nearest first", () => {
    const [a] = anchorsIn("the `alpha` Map in `beta` ([src/x.ts:9](../src/x.ts#L9)).");
    expect(a.idents).toEqual(["beta", "alpha"]);
    expect(a.file).toBe("src/x.ts");
    expect(a.line).toBe(9);
  });

  it("reads `fn()` as the identifier fn", () => {
    const [a] = anchorsIn("entry `ingest()` ([:5](../src/x.ts#L5)).");
    expect(a.idents).toEqual(["ingest"]);
  });

  it("ignores a link with no line anchor", () => {
    expect(anchorsIn("see [src/x.ts](../src/x.ts) for details")).toEqual([]);
  });

  it("prefers an export over a later declaration or a mention", () => {
    const src = ["import { thing } from './t';", "const thing = 1;", "export const thing = 2;"].join("\n");
    expect(defineLine(src, "thing")).toEqual({ line: 3, tier: 1 });
  });

  it("never points at an import or a comment line", () => {
    const src = ["import { thing } from './t';", "// thing is used below", "call(thing);"].join("\n");
    expect(defineLine(src, "thing")).toEqual({ line: 3, tier: 4 });
  });

  it("reports tier 4 for a symbol that is only used, so callers can de-pin it", () => {
    expect(defineLine("call(thing);", "thing").tier).toBe(4);
  });

  it("reports line 0 for a symbol that is not there at all", () => {
    expect(defineLine("const other = 1;", "thing")).toEqual({ line: 0, tier: 0 });
  });
});

describe("the command-line entry point", () => {
  // `node scripts/doc-anchors.mjs [--fix]` is what a contributor runs. Its
  // "am I the main module?" check compared a file URL with a native path, which
  // never matches on Windows: the script exited 0 having checked nothing.
  it("actually runs when invoked directly", () => {
    const r = spawnSync(process.execPath, [join(process.cwd(), "scripts", "doc-anchors.mjs")], { encoding: "utf8" });
    expect(r.stdout).toMatch(/\d+ anchors checked/);
  });
});

describe("--fix keeps the definition the author chose", () => {
  it("re-points a drifted anchor at the NEAREST definition, not the first", async () => {
    const { mkdtempSync, writeFileSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { nearestDefinition } = await import("../../scripts/doc-anchors.mjs");
    const file = join(mkdtempSync(join(tmpdir(), "anchors-")), "store.ts");
    // A store action is defined twice: its interface member and its body.
    writeFileSync(file, ["interface S {", "  saveDoc: () => void;", "}", "", "", "", "", "", "const store = {", "  saveDoc: () => {},", "};"].join("\n"));
    expect(nearestDefinition(file, "saveDoc", 12)).toBe(10); // was at the body: stays with the body
    expect(nearestDefinition(file, "saveDoc", 1)).toBe(2);   // was at the declaration: stays there
  });
});
