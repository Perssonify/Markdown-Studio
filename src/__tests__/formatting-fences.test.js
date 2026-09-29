import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { headingsCaseCM } from "../formatting/case-transform";
import { fencedBlocks, fencedLineMask, selectScopeCM } from "../formatting/select-scope";

/**
 * A062. Heading detection for the case transforms, "Format all headings" and
 * the Select ▸ headings scope ignored fences: `# install deps` inside a
 * ```bash block was upper-cased or bolded along with the real headings.
 */

const lines = (s) => s.split("\n");

describe("fencedBlocks — CommonMark fence rules", () => {
  it("finds backtick and tilde fences", () => {
    expect(fencedBlocks(lines("a\n```js\nx\n```\nb\n~~~\ny\n~~~"))).toEqual([{ start: 1, end: 3 }, { start: 5, end: 7 }]);
  });

  it("closes only with the same character, at least as long", () => {
    // ```` holds a ``` line; ~~~ holds ```.
    expect(fencedBlocks(lines("````md\n```\n# inner\n```\n````\n# out"))).toEqual([{ start: 0, end: 4 }]);
    expect(fencedBlocks(lines("~~~\n```\n~~~"))).toEqual([{ start: 0, end: 2 }]);
  });

  it("does not close on a fence line that carries text after it", () => {
    expect(fencedBlocks(lines("```\ncode\n``` not a close\n```"))).toEqual([{ start: 0, end: 3 }]);
  });

  it("allows up to three spaces of indent, not four", () => {
    expect(fencedBlocks(lines("   ```\nx\n   ```"))).toEqual([{ start: 0, end: 2 }]);
    expect(fencedBlocks(lines("    ```\nx\n    ```"))).toEqual([]);
  });

  it("rejects a backtick info string that contains a backtick", () => {
    expect(fencedBlocks(lines("``` a`b\n# heading"))).toEqual([]);
  });

  it("runs an unclosed fence to the end of the document", () => {
    expect(fencedBlocks(lines("text\n```\n# not a heading\nmore"))).toEqual([{ start: 1, end: 3 }]);
    expect(fencedLineMask(lines("text\n```\n# x"))).toEqual([false, true, true]);
  });
});

const views = [];
afterEach(() => { while (views.length) views.pop().destroy(); });
function view(doc) {
  const v = new EditorView({
    state: EditorState.create({ doc, extensions: [EditorState.allowMultipleSelections.of(true)] }),
    parent: document.createElement("div"),
  });
  views.push(v);
  return v;
}

const DOC = [
  "# Setup",
  "",
  "```bash",
  "# install deps",
  "npm install",
  "```",
  "",
  "````md",
  "```",
  "# still code",
  "```",
  "````",
  "",
  "## Next step",
].join("\n");

describe("heading tools leave code alone (A062)", () => {
  it("UPPERCASE all headings skips `# comments` in fenced blocks", () => {
    const v = view(DOC);
    headingsCaseCM(v, "upper", false);
    const out = v.state.doc.toString();
    expect(out).toContain("# SETUP");
    expect(out).toContain("## NEXT STEP");
    expect(out).toContain("# install deps");
    expect(out).toContain("# still code");
  });

  it("Select ▸ All headings skips them too, including inside a longer fence", () => {
    const v = view(DOC);
    expect(selectScopeCM(v, "headings")).toBe(2);
    expect(v.state.selection.ranges.map((r) => v.state.sliceDoc(r.from, r.to))).toEqual(["Setup", "Next step"]);
  });

  it("Select ▸ Code blocks selects each block whole, the longer fence included", () => {
    const v = view(DOC);
    expect(selectScopeCM(v, "codeBlock")).toBe(2);
    const [a, b] = v.state.selection.ranges.map((r) => v.state.sliceDoc(r.from, r.to));
    expect(a.startsWith("```bash") && a.endsWith("```")).toBe(true);
    expect(b.startsWith("````md") && b.endsWith("````")).toBe(true);
  });
});
