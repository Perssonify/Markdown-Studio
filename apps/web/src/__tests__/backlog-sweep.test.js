import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { EXPORT_CONTENT_CSS } from "../store/importExport/import-export";

/**
 * The remaining backlog items, revalidated at HEAD and fixed where real. Their
 * recorded verdicts were measured five releases ago; two of the eleven turned
 * out to be stale rather than open, which is why each of these says what was
 * actually wrong rather than quoting the entry.
 */

const read = (p) => readFileSync(join(process.cwd(), p), "utf8");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("A6 — exported and printed documents can break a long line", () => {
  it("does not rely on horizontal scrolling, which paper does not have", () => {
    // `overflow-x: auto` is meaningless in print: an over-wide line is clipped
    // off the page rather than scrolled to.
    // Assert the BODY rule specifically. "contains overflow-wrap" passed with
    // the body rule deleted, because the th/td rule also carries it — a check
    // that could not fail for the thing it was written about.
    const body = EXPORT_CONTENT_CSS.split("\n").find((l) => l.trim().startsWith("body {"));
    expect(body, "body rule present").toBeTruthy();
    expect(body).toContain("overflow-wrap: anywhere");
    const pre = EXPORT_CONTENT_CSS.split("\n").find((l) => l.trim().startsWith("pre {"));
    expect(pre).toContain("white-space: pre-wrap");
  });

  it("lets a wide table's cells wrap instead of overflowing the page", () => {
    expect(EXPORT_CONTENT_CSS).toContain("table-layout: fixed");
    const cells = EXPORT_CONTENT_CSS.split("\n").find((l) => l.trim().startsWith("th, td"));
    expect(cells).toContain("overflow-wrap: anywhere");
  });
});

describe("A8 — the menu-bar document title does not clip its own letters", () => {
  it("gives the truncating title a line box taller than the font", () => {
    // `leading-none` sets line-height to exactly the font size, so with
    // `truncate`'s overflow:hidden a tall diacritic (Å, Ą) or a descender is
    // cut off.
    // codeOnly: the comment beside the fix names `leading-none`, so the raw
    // source would satisfy the "not to contain" check for the wrong reason.
    const menu = codeOnly(read("src/ui/MenuBar.tsx"));
    // Anchored on the title expression (its fallback is translated since A099).
    const anchor = '{props.docTitle || t("common.untitled")}';
    expect(menu).toContain(anchor);
    const title = menu.slice(menu.indexOf(anchor) - 400, menu.indexOf(anchor));
    expect(title).toContain("leading-tight");
    expect(title).not.toContain("leading-none");
  });
});

describe("A9 — only the header under the floating trigger pays for it", () => {
  const panes = codeOnly(read("src/ui/EditorPanes.tsx"));

  it("makes the 44px clearance conditional", () => {
    // The trigger is absolutely positioned at the editor's top-left, so exactly
    // one header sits under it. Applying the padding to every header spent 44px
    // of the second pane's width on a phone — where width is scarcest, and
    // where the panes stack so the second header is nowhere near the trigger.
    // Assert the padding is genuinely CONDITIONAL. Checking only that the word
    // `clearsTrigger` appears passed with the class list hardcoded back, since
    // the prop still existed on the interface.
    expect(panes).toContain('clearsTrigger ? "pl-11" : "pl-4"');
    expect(panes).not.toContain("pl-11 pr-4 md:pl-4");
  });

  it("gives it to the markdown pane, which is the one on top when stacked", () => {
    expect(panes).toContain('label={t("panes.markdown")} headerRef={headerRef} clearsTrigger');
  });
});

describe("E8 — the scroll-sync toggle is reachable by finger", () => {
  it("grows the button on coarse pointers while the icon stays 16px", () => {
    const panes = codeOnly(read("src/ui/EditorPanes.tsx"));
    expect(panes).toContain("pointer-coarse:h-8");
    expect(panes).toContain("pointer-coarse:w-8");
  });
});

describe("B2 — a toast does not land on the status bar", () => {
  it("offsets the toaster past the bar", () => {
    const pe = codeOnly(read("src/PerssonifyEditor.tsx"));
    expect(pe).toMatch(/offset=\{\d+\}/);
  });
});

describe("F3 — a broken wiki link looks broken", () => {
  // A058: the three source pins that stood here asserted the DOM-mutation
  // implementation (`setAttribute("data-unresolved"`…), and passed for as long
  // as the feature never once worked — it compared "[object Object]" against
  // link targets. The behaviour (marking, clearing, same-document anchors, a
  // freshly typed link) is now held by links-resolution.test.js against a real
  // editor; what stays here is the wiring and the stylesheet.
  const hook = codeOnly(read("src/hooks/useLinkIndex.ts"));
  const pane = codeOnly(read("src/ui/TiptapPane.tsx"));
  const css = read("src/styles.css");

  it("marks unresolved links with a decoration fed the library, not by writing PM's DOM", () => {
    expect(hook).toContain("setWikiLinkLibrary(");
    expect(hook).not.toContain('setAttribute("data-unresolved"');
    expect(pane).toContain("UnresolvedWikiLinks");
  });

  it("styles it in both panes", () => {
    expect(css).toContain(".ProseMirror a.wiki-link[data-unresolved]");
    expect(css).toContain("[data-md-preview] a.wiki-link[data-unresolved]");
    expect(css).toContain(".ProseMirror a.wiki-link:has(.wiki-link-unresolved)");
  });
});

describe("F4 — the seeded document's title follows its heading", () => {
  it("does not set userTitle, which would read as a user rename", () => {
    // `resolveDocTitle` treats a non-placeholder `userTitle` as a pin, so
    // seeding one made the welcome document permanently "Welcome" while its own
    // H1 read "Markdown Studio" — and editing that heading renamed nothing,
    // alone among every document in the app.
    // The seeding is in the editor's boot sequence (src/editor/useEditorBoot.ts).
    const boot = codeOnly(read("src/editor/useEditorBoot.ts"));
    const at = boot.indexOf("if (initialDocument.title)");
    expect(at).toBeGreaterThan(-1);
    const seed = boot.slice(at);
    const body = seed.slice(0, seed.indexOf("}") + 1);
    expect(body).toContain("doc.title = initialDocument.title");
    expect(body).not.toContain("doc.userTitle");
    // …and that sequence is the one the editor runs, with the prop handed in.
    const pe = codeOnly(read("src/PerssonifyEditor.tsx"));
    expect(pe).toMatch(/useEditorBoot\(\{[^;]*\binitialDocument,/);
  });
});
