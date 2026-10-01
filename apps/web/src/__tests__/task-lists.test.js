import { Editor } from "@tiptap/core";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import StarterKit from "@tiptap/starter-kit";
import TurndownService from "turndown";
import { describe, expect, it } from "vitest";
import { buildMarked } from "../engine/build-marked";
import { cleanHtmlForTurndown } from "../engine/html-cleaner";
import { addBaseRules } from "../engine/turndown-rules.ts";
import { DEFAULT_MARKDOWN_FEATURES } from "../store/settings";

// Interactive task lists round-trip: markdown `- [ ]`/`- [x]` → TaskList/TaskItem
// nodes (via the marked renderer override) → back to markdown (turndown rule).
function td() {
  const t = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", emDelimiter: "*" });
  addBaseRules(t);
  return t;
}

function editor() {
  return new Editor({
    extensions: [StarterKit, TaskList, TaskItem.configure({ nested: true })],
    content: "",
  });
}

// Full loop: md → html → editor → html → clean → turndown → md
function roundTrip(md) {
  const m = buildMarked(DEFAULT_MARKDOWN_FEATURES); // gfm + taskLists on
  const html = m.parse(md, { async: false });
  const ed = editor();
  ed.commands.setContent(html);
  const out = td().turndown(cleanHtmlForTurndown(ed.getHTML()));
  ed.destroy();
  return { html, out };
}

describe("interactive task lists", () => {
  it("marked emits TaskList/TaskItem markup, not a disabled input", () => {
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    const html = m.parse("- [x] done\n- [ ] todo", { async: false });
    expect(html).toContain('data-type="taskList"');
    expect(html).toContain('data-type="taskItem"');
    expect(html).toContain('data-checked="true"');
    expect(html).toContain('data-checked="false"');
    expect(html).not.toContain("<input");
  });

  it("round-trips checked and unchecked items", () => {
    const { out } = roundTrip("- [x] done\n- [ ] todo");
    expect(out).toContain("- [x] done");
    expect(out).toContain("- [ ] todo");
  });

  it("preserves inline markdown inside a task item", () => {
    const { html, out } = roundTrip("- [ ] pick up **milk** and [bread](/b)");
    // rendered item keeps the bold/link
    expect(html).toContain("<strong>milk</strong>");
    // serialized back with the inline syntax intact
    expect(out).toContain("- [ ] ");
    expect(out).toContain("**milk**");
    expect(out).toContain("[bread](/b)");
  });

  it("round-trips a nested task list", () => {
    const { out } = roundTrip("- [ ] parent\n  - [x] child");
    expect(out).toMatch(/- \[ \] parent/);
    expect(out).toMatch(/- \[x\] child/);
    // child is indented under the parent marker
    expect(out).toMatch(/\n\s{2,}- \[x\] child/);
  });

  it("keeps a plain bullet list as a bullet (no checkbox)", () => {
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    const html = m.parse("- one\n- two", { async: false });
    expect(html).not.toContain('data-type="taskList"');
    expect(html).not.toContain("data-checked");
  });

  it("does NOT mis-tag a regular list that merely CONTAINS a nested task list", () => {
    // Regression: `body.includes('data-type=taskItem')` wrongly tagged the outer
    // <ul> as a taskList (a plain <li> inside a taskList → broken). The outer list
    // must stay a plain bullet; only the nested list is a taskList.
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    const html = m.parse("- regular item\n  - [ ] nested task", { async: false });
    // The first <ul> must be plain (no data-type), the nested one a taskList.
    expect(html.indexOf("<ul>")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("<ul>")).toBeLessThan(html.indexOf('<ul data-type="taskList"'));
    // The regular item is a plain <li>, not a taskItem.
    expect(html).toContain("<li>regular item");
  });

  it("round-trips a regular list with a nested task child (outer stays bullets)", () => {
    const { out } = roundTrip("- regular item\n  - [ ] nested task");
    expect(out).toMatch(/^- regular item/m);
    expect(out).not.toMatch(/^- \[[ x]\] regular item/m); // outer NOT a task
    expect(out).toMatch(/- \[ \] nested task/);
  });

  it("demotes ordered 'task' items to literal text (ol can't hold taskItems)", () => {
    // `1. [ ] x` is non-standard GFM; taskItem inside <ol> violates the TipTap
    // schema (would coerce to an empty <ol> + stray taskList). Demote to plain
    // items with a literal [ ]/[x] prefix so they survive and round-trip.
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    const html = m.parse("1. [ ] first\n2. [x] second", { async: false });
    expect(html).toContain("<ol>");
    expect(html).not.toContain('data-type="taskItem"');
    expect(html).toContain("<li>[ ] first</li>");
    expect(html).toContain("<li>[x] second</li>");
  });

  it("preserves a nested task list inside an ordered list (demote must not touch it)", () => {
    const m = buildMarked(DEFAULT_MARKDOWN_FEATURES);
    const html = m.parse("1. ordered item\n   - [ ] nested task", { async: false });
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>ordered item");
    expect(html).toContain('<ul data-type="taskList">');
    expect(html).toContain('<li data-type="taskItem" data-checked="false">nested task</li>');
  });

  it("does not treat tasks specially in commonmark (no gfm)", () => {
    const m = buildMarked({ ...DEFAULT_MARKDOWN_FEATURES, flavor: "commonmark" });
    const html = m.parse("- [ ] todo", { async: false });
    expect(html).not.toContain('data-type="taskList"');
  });

  it("falls back to marked's default checkbox when taskLists is off", () => {
    const m = buildMarked({ ...DEFAULT_MARKDOWN_FEATURES, taskLists: false });
    const html = m.parse("- [x] todo", { async: false });
    expect(html).not.toContain('data-type="taskItem"');
    expect(html).toContain('type="checkbox"');
  });
});
