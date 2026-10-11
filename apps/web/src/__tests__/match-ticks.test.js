import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

/**
 * C4. The Find & Replace scrollbar ticks are FRACTIONS of the scroller's
 * height, computed once and held in state — so they go stale the moment either
 * the matches or that height move.
 *
 * The effect that computes them depended on `findText`, the search options, a
 * set of `useRef` objects and `[]`-dep `useCallback`s, and `matchCount`. Every
 * one of those is either user-set or identity-stable, and `matchCount` only
 * ever holds a COUNT — so inserting twenty lines above the first match changed
 * nothing it watched. Measured previously: three matches at 18.69 / 57.94 /
 * 97.20% of a 2568px document; after inserting 30 lines at the top (count still
 * 3, scrollHeight now 3288) the ticks had not moved while the true fractions
 * were 36.86 / 67.52 / 98.18% — the first tick 18.2 percentage points, about
 * 148px, wrong.
 *
 * Source pins: the failure is a missing DEPENDENCY, which is invisible to a
 * render-and-assert test — the component would have to be driven through a real
 * CodeMirror with real layout for the numbers to mean anything, and that is the
 * e2e campaign's job. What can be pinned here is that the signal exists and is
 * wired.
 */

const src = readFileSync(join(process.cwd(), "src/ui/find/findReplace/index.tsx"), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = codeOnly(src);

describe("the marker effect watches the document, not just the match count", () => {
  it("has a revision signal", () => {
    expect(code).toContain("docRevision");
  });

  it("depends on it", () => {
    // The dep array is the whole defect; the value existing without being
    // depended on would change nothing.
    const effect = code.slice(code.indexOf("if (!findText) { setMarkers([]); return; }"));
    // Search for the closing bracket FROM the dep array's opening one: the
    // effect body contains `setMarkers([]);`, whose `]);` comes first and made
    // this slice empty — an assertion that passed on "" containing nothing.
    const start = effect.indexOf("}, [");
    const deps = effect.slice(start, effect.indexOf("]);", start) + 3);
    expect(deps.length).toBeGreaterThan(10);
    expect(deps).toContain("docRevision");
    expect(deps).toContain("matchCount");
  });

  it("observes edits AND the height the fractions are computed against", () => {
    // Both, because they fail independently: an edit can move matches without
    // changing scrollHeight, and a reflow can change scrollHeight with no edit.
    expect(code).toContain("MutationObserver");
    expect(code).toContain("ResizeObserver");
  });

  it("watches the content element, not only the scroller", () => {
    expect(code).toContain('querySelector(".cm-content, .ProseMirror")');
  });

  it("coalesces a burst of mutations into one bump", () => {
    // A MutationObserver fires per batch while typing; without coalescing this
    // would queue a state update per keystroke behind the 120ms debounce.
    expect(code).toContain("queueMicrotask");
    expect(code).toContain("if (queued) return;");
  });

  it("disconnects both observers", () => {
    expect(code).toContain("mo.disconnect()");
    expect(code).toContain("ro.disconnect()");
  });
});
