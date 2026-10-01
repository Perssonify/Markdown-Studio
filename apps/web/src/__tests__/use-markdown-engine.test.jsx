import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useMarkdownEngine } from "../engine/useMarkdownEngine";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";
import { useUIStore } from "../store/uiStore";

/**
 * The conversion engine's HOOK. `build-marked`, the preprocessor and the
 * turndown rules are all tested individually; what was not was the object that
 * wires them together and hands it to the sync engine — including the two
 * properties the rest of the app leans on:
 *
 *  - the engine object's IDENTITY stays stable across a settings change (it
 *    reads its refs at call time), because the sync engine holds it in effect
 *    dependencies and a new object there re-runs the whole projection chain;
 *  - `configVersion` is the signal that the config moved, so already-rendered
 *    content can be re-synced without that identity change.
 *
 * Get the pair backwards and either settings do nothing until you retype, or
 * every settings read costs a re-render cascade.
 */

function mount() {
  return renderHook(() => useMarkdownEngine());
}

beforeEach(() => {
  useUIStore.setState({ markdownFeatures: DEFAULT_MARKDOWN_FEATURES });
  document.getElementById("md-preview-styles")?.remove();
});
afterEach(() => {
  useUIStore.setState({ markdownFeatures: DEFAULT_MARKDOWN_FEATURES });
});

describe("useMarkdownEngine — lifecycle", () => {
  it("is ready with all three converters after mount", () => {
    const { result } = mount();
    expect(result.current.ready).toBe(true);
    const e = result.current.engine;
    expect(typeof e.mdToHtml).toBe("function");
    expect(typeof e.htmlToMd).toBe("function");
    expect(typeof e.htmlToCleanMd).toBe("function");
  });

  it("injects the preview stylesheet exactly once, however many editors mount", () => {
    mount();
    mount();
    expect(document.querySelectorAll("#md-preview-styles")).toHaveLength(1);
    const css = document.getElementById("md-preview-styles").textContent;
    expect(css).toContain("[data-md-preview] h1");
    expect(css).toContain('ul[data-type="taskList"]');
  });
});

describe("useMarkdownEngine — settings changes", () => {
  it("keeps the engine object identical while bumping configVersion", () => {
    const { result } = mount();
    const engine = result.current.engine;
    const version = result.current.configVersion;

    act(() => {
      useUIStore.getState().setMarkdownFeatures((f) => ({ ...f, taskLists: false }));
    });

    expect(result.current.engine).toBe(engine);
    expect(result.current.configVersion).toBe(version + 1);
  });

  it("the SAME engine object converts with the NEW settings", () => {
    // The stable identity is only safe because the converters read their refs
    // at call time. If they closed over the marked instance, a settings change
    // would be inert until something forced a remount.
    const { result } = mount();
    const engine = result.current.engine;
    expect(engine.mdToHtml("- [ ] a task")).toContain('data-type="taskList"');

    act(() => {
      useUIStore.getState().setMarkdownFeatures((f) => ({ ...f, taskLists: false }));
    });

    expect(engine.mdToHtml("- [ ] a task")).not.toContain('data-type="taskList"');
  });

  it("honours the callouts flag", () => {
    const { result } = mount();
    const engine = result.current.engine;
    expect(engine.mdToHtml("> [!NOTE]\n> heads up")).toContain('data-type="callout"');

    act(() => {
      useUIStore.getState().setMarkdownFeatures((f) => ({ ...f, callouts: false }));
    });
    const off = engine.mdToHtml("> [!NOTE]\n> heads up");
    expect(off).not.toContain('data-type="callout"');
    expect(off).toContain("<blockquote");
  });
});

describe("useMarkdownEngine — mdToHtml", () => {
  const engine = () => mount().result.current.engine;

  it("renders wiki links as clickable link marks, not plain text", () => {
    // Internal links are a core feature and the renderer had shipped with them
    // off: [[Doc]] appeared as literal text with no styling and no click target.
    const html = engine().mdToHtml("See [[Other Doc]] and [[Guide#Install]].");
    expect(html).toContain("data-doc-link");
    expect(html).toContain('data-anchor="Install"');
    expect(html).not.toContain("[[Other Doc]]");
  });

  it("styles ordinary lists inline so the rich pane shows markers", () => {
    const html = engine().mdToHtml("- one\n- two\n\n1. first");
    expect(html).toContain("list-style:disc outside");
    expect(html).toContain("list-style:decimal outside");
    expect(html).toContain("display:list-item");
  });

  it("leaves task lists alone — a disc would sit beside the checkbox", () => {
    const html = engine().mdToHtml("- [ ] todo\n- [x] done");
    expect(html).toContain('data-type="taskList"');
    expect(html).not.toContain("list-style:disc outside");
    expect(html).not.toMatch(/<li style="display:list-item[^>]*data-type="taskItem"/);
  });

  it("styles a plain list that merely CONTAINS a task list", () => {
    const html = engine().mdToHtml("- outer\n  - [ ] inner task");
    expect(html).toContain("list-style:disc outside");
    expect(html).toContain('data-type="taskList"');
  });

  it("renders headings, emphasis, code and tables", () => {
    const html = engine().mdToHtml(
      "# Title\n\n**bold** and *em* and `code`\n\n| a | b |\n| --- | --- |\n| 1 | 2 |"
    );
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<code>");
    expect(html).toContain("<table>");
  });

  it("handles an empty document without throwing", () => {
    expect(engine().mdToHtml("")).toBe("");
  });
});

describe("useMarkdownEngine — htmlToMd", () => {
  const engine = () => mount().result.current.engine;

  it("round-trips the common structures", () => {
    const e = engine();
    const src = "# Title\n\nSome **bold** text.\n\n- one\n- two\n\n> quote";
    const back = e.htmlToMd(e.mdToHtml(src));
    expect(back).toContain("# Title");
    expect(back).toContain("**bold**");
    expect(back).toContain("- one");
    expect(back).toContain("> quote");
  });

  it("round-trips a wiki link back to its source form", () => {
    const e = engine();
    expect(e.htmlToMd(e.mdToHtml("Look at [[Other Doc]]."))).toContain("[[Other Doc]]");
  });

  it("round-trips task list state", () => {
    const e = engine();
    const back = e.htmlToMd(e.mdToHtml("- [ ] todo\n- [x] done"));
    expect(back).toContain("- [ ] todo");
    expect(back).toContain("- [x] done");
  });

  it("keeps inline styles in htmlToMd and drops them in htmlToCleanMd", () => {
    // The two converters exist for exactly this difference: the pane keeps
    // colour/highlight spans, an export strips them.
    const e = engine();
    const html = '<p><span style="background-color: #ff0">marked</span> text</p>';
    expect(e.htmlToMd(html)).toContain("background-color");
    expect(e.htmlToCleanMd(html)).not.toContain("background-color");
    expect(e.htmlToCleanMd(html)).toContain("marked");
  });

  it("does not collapse blank lines inside fenced code", () => {
    // normalizeMarkdown's whitespace passes run on EVERY rich→markdown
    // projection; masking the fence is what stops them eating code.
    const e = engine();
    const back = e.htmlToMd("<pre><code>line one\n\n\nline two</code></pre>");
    expect(back).toContain("line one\n\n\nline two");
  });

  it("survives empty and whitespace-only HTML", () => {
    const e = engine();
    expect(e.htmlToMd("")).toBe("");
    expect(e.htmlToMd("<p></p>").trim()).toBe("");
  });
});
