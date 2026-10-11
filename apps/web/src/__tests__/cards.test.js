import { describe, expect, it } from "vitest";
import {
  CARD_COLORS,
  CARD_COLOR_KEY,
  CARD_PINNED_KEY,
  cardChecklist,
  cardColorValue,
  cardPreview,
  cardPreviewHtml,
  composeNoteMarkdown,
  filterCards,
  getCardColor,
  isCardPinned,
  isEmptyCapture,
  partitionPinned,
  sortCards,
} from "../store/cards/cards.ts";

const p = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (text, level = 1) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const task = (text, checked) => ({
  type: "taskItem",
  attrs: { checked },
  content: [p(text)],
});
const doc = (...content) => ({ type: "doc", content });

describe("card colour metadata", () => {
  it("defaults to 'default' when unset, malformed, or unknown", () => {
    expect(getCardColor(undefined)).toBe("default");
    expect(getCardColor({ id: "a" })).toBe("default");
    expect(getCardColor({ id: "a", metadata: null })).toBe("default");
    expect(getCardColor({ id: "a", metadata: { [CARD_COLOR_KEY]: 42 } })).toBe("default");
    expect(getCardColor({ id: "a", metadata: { [CARD_COLOR_KEY]: "chartreuse" } })).toBe("default");
  });

  it("reads a valid colour id", () => {
    expect(getCardColor({ id: "a", metadata: { [CARD_COLOR_KEY]: "teal" } })).toBe("teal");
  });

  it("gives every non-default colour a distinct light and dark value", () => {
    for (const c of CARD_COLORS) {
      if (c.id === "default") {
        expect(cardColorValue("default", false)).toBe("");
        expect(cardColorValue("default", true)).toBe("");
        continue;
      }
      expect(cardColorValue(c.id, false)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(cardColorValue(c.id, true)).toMatch(/^#[0-9a-f]{6}$/i);
      expect(cardColorValue(c.id, false)).not.toBe(cardColorValue(c.id, true));
    }
  });

  it("has unique colour ids", () => {
    const ids = CARD_COLORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("pinning", () => {
  it("is true only for an exact boolean true", () => {
    expect(isCardPinned({ id: "a" })).toBe(false);
    expect(isCardPinned({ id: "a", metadata: { [CARD_PINNED_KEY]: "yes" } })).toBe(false);
    expect(isCardPinned({ id: "a", metadata: { [CARD_PINNED_KEY]: true } })).toBe(true);
  });
});

describe("cardPreview", () => {
  it("returns empty for an empty or missing document", () => {
    expect(cardPreview(null)).toBe("");
    expect(cardPreview(doc())).toBe("");
  });

  it("separates block-level text instead of jamming it together", () => {
    // A four-item list previewed as "milkeggsbreadcoffee" on the real board:
    // nodeText concatenated every descendant with no separator.
    const list = {
      type: "bulletList",
      content: ["milk", "eggs", "bread", "coffee"].map((t) => ({
        type: "listItem",
        content: [p(t)],
      })),
    };
    expect(cardPreview(doc(list))).toBe("milk eggs bread coffee");
  });

  it("treats a soft line break as a separator", () => {
    // Typing three lines into the composer makes ONE paragraph with hardBreaks;
    // they carry no text themselves, so the preview read "line1line2line3".
    const multiline = {
      type: "paragraph",
      content: [
        { type: "text", text: "line1" },
        { type: "hardBreak" },
        { type: "text", text: "line2" },
        { type: "hardBreak" },
        { type: "text", text: "line3" },
      ],
    };
    expect(cardPreview(doc(multiline))).toBe("line1 line2 line3");
  });

  it("keeps a single paragraph's text runs unspaced", () => {
    // Marks split one sentence into several text nodes; those must NOT gain
    // spaces, or every bold word would come back with a gap beside it.
    const split = {
      type: "paragraph",
      content: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world", marks: [{ type: "bold" }] },
        { type: "text", text: "!" },
      ],
    };
    expect(cardPreview(doc(split))).toBe("Hello world!");
  });

  it("can drop task lists, which the card renders as real tick-boxes", () => {
    const tasks = { type: "taskList", content: [task("buy milk", false), task("call mum", true)] };
    const d = doc(p("Before the weekend"), tasks);
    expect(cardPreview(d)).toBe("Before the weekend buy milk call mum");
    expect(cardPreview(d, undefined, 220, { skipTasks: true })).toBe("Before the weekend");
  });

  it("returns empty when a note is nothing but a checklist", () => {
    const only = doc({ type: "taskList", content: [task("one", false)] });
    expect(cardPreview(only, undefined, 220, { skipTasks: true })).toBe("");
  });

  it("skips a leading H1 that duplicates the card title", () => {
    const d = doc(h("Shopping"), p("Milk and eggs"));
    expect(cardPreview(d, "Shopping")).toBe("Milk and eggs");
  });

  it("keeps the heading when it is NOT the title", () => {
    const d = doc(h("Section"), p("Body"));
    expect(cardPreview(d, "Different title")).toContain("Section");
  });

  it("collapses whitespace across blocks", () => {
    const d = doc(p("one   two"), p("three"));
    expect(cardPreview(d)).toBe("one two three");
  });

  it("truncates at the limit and adds an ellipsis", () => {
    const long = "word ".repeat(200);
    const out = cardPreview(doc(p(long)), undefined, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not add an ellipsis when content fits exactly", () => {
    const out = cardPreview(doc(p("short")), undefined, 50);
    expect(out).toBe("short");
  });

  it("reads nested inline content", () => {
    const d = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "bold" },
        { type: "text", text: " and " },
        { type: "text", text: "italic" },
      ],
    });
    expect(cardPreview(d)).toBe("bold and italic");
  });
});

describe("cardPreviewHtml", () => {
  const marked = (text, type) => ({ type: "text", text, marks: [{ type }] });

  it("renders headings, paragraphs and lists as real structure", () => {
    const d = doc(
      h("Shopping", 2),
      p("Get these before the weekend:"),
      { type: "bulletList", content: [
        { type: "listItem", content: [p("milk")] },
        { type: "listItem", content: [p("eggs")] },
      ] },
    );
    const html = cardPreviewHtml(d);
    expect(html).toContain("<h2>Shopping</h2>");
    expect(html).toContain("<p>Get these before the weekend:</p>");
    expect(html).toContain("<ul><li>milk</li><li>eggs</li></ul>");
  });

  it("renders inline marks around escaped text", () => {
    const d = doc({ type: "paragraph", content: [
      { type: "text", text: "plain " },
      marked("bold", "bold"),
      { type: "text", text: " and " },
      marked("code", "code"),
    ] });
    const html = cardPreviewHtml(d);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("escapes text so a note can never inject markup", () => {
    // The whole reason this returns a string we dangerouslySetInnerHTML.
    const d = doc(p('<img src=x onerror="alert(1)"> & <b>hi</b>'));
    const html = cardPreviewHtml(d);
    // The angle brackets are escaped, so the <img> is inert text — "onerror"
    // survives only as visible characters, never as a live attribute.
    expect(html).not.toContain("<img");
    expect(html).not.toContain('onerror="alert');
    expect(html).toContain("&lt;img");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
  });

  it("renders a link mark as an <a> with NO href, so it cannot navigate", () => {
    // The card face IS a button; a real href would steal the click.
    const d = doc({ type: "paragraph", content: [
      { type: "text", text: "site", marks: [{ type: "link", attrs: { href: "https://evil.test" } }] },
    ] });
    const html = cardPreviewHtml(d);
    expect(html).toContain("<a>site</a>");
    expect(html).not.toContain("href");
  });

  it("skips the title heading, like the plain-text preview", () => {
    const d = doc(h("My Note", 1), p("body"));
    expect(cardPreviewHtml(d, "My Note")).toBe("<p>body</p>");
  });

  it("skips task lists when asked (the card draws real tick-boxes)", () => {
    const d = doc(
      p("intro"),
      { type: "taskList", content: [task("do it", false)] },
    );
    expect(cardPreviewHtml(d, undefined, { skipTasks: true })).toBe("<p>intro</p>");
  });

  it("is bounded — a huge document costs a handful of blocks", () => {
    const many = doc(...Array.from({ length: 5000 }, (_, i) => p("line " + i)));
    const html = cardPreviewHtml(many, undefined, { maxBlocks: 8 });
    // At most 8 <p> elements, not 5000.
    expect((html.match(/<p>/g) || []).length).toBeLessThanOrEqual(8);
  });

  it("returns an empty string for an empty document", () => {
    expect(cardPreviewHtml(doc())).toBe("");
    expect(cardPreviewHtml(null)).toBe("");
    expect(cardPreviewHtml({ type: "doc" })).toBe("");
  });
});

describe("cardChecklist", () => {
  it("returns an empty checklist for a document with no tasks", () => {
    const c = cardChecklist(doc(p("just prose")));
    expect(c.total).toBe(0);
    expect(c.items).toEqual([]);
    expect(c.overflow).toBe(0);
  });

  it("extracts items with their checked state and counts done", () => {
    const d = doc({
      type: "taskList",
      content: [task("buy milk", false), task("call mum", true)],
    });
    const c = cardChecklist(d);
    expect(c.total).toBe(2);
    expect(c.done).toBe(1);
    expect(c.items[0]).toEqual({ text: "buy milk", checked: false });
    expect(c.items[1]).toEqual({ text: "call mum", checked: true });
  });

  it("finds nested task items", () => {
    const nested = {
      type: "taskItem",
      attrs: { checked: false },
      content: [p("parent"), { type: "taskList", content: [task("child", true)] }],
    };
    const c = cardChecklist(doc({ type: "taskList", content: [nested] }));
    expect(c.total).toBe(2);
    expect(c.items.some((i) => i.text === "child" && i.checked)).toBe(true);
  });

  it("caps the item count and reports the overflow", () => {
    const items = Array.from({ length: 10 }, (_, i) => task("t" + i, false));
    const c = cardChecklist(doc({ type: "taskList", content: items }), 3);
    expect(c.items).toHaveLength(3);
    expect(c.overflow).toBe(7);
    expect(c.total).toBe(10);
  });

  it("treats a non-true checked attr as unchecked", () => {
    const c = cardChecklist(doc({ type: "taskList", content: [task("x", "true")] }));
    expect(c.items[0].checked).toBe(false);
  });
});

describe("sortCards", () => {
  const mk = (id, updated, pinned) => ({
    id,
    updated,
    metadata: pinned ? { [CARD_PINNED_KEY]: true } : {},
  });

  it("puts pinned cards first, then newest", () => {
    const out = sortCards([
      mk("a", "2026-01-01T00:00:00Z", false),
      mk("b", "2026-01-03T00:00:00Z", false),
      mk("c", "2026-01-02T00:00:00Z", true),
    ]);
    expect(out.map((d) => d.id)).toEqual(["c", "b", "a"]);
  });

  it("is stable by id for identical timestamps", () => {
    const t = "2026-01-01T00:00:00Z";
    const out = sortCards([mk("z", t), mk("a", t), mk("m", t)]);
    expect(out.map((d) => d.id)).toEqual(["a", "m", "z"]);
  });

  it("does not mutate the input array", () => {
    const input = [mk("a", "2026-01-01T00:00:00Z"), mk("b", "2026-01-02T00:00:00Z")];
    const copy = [...input];
    sortCards(input);
    expect(input).toEqual(copy);
  });

  it("treats a missing/invalid date as oldest without throwing", () => {
    const out = sortCards([mk("a", undefined), mk("b", "2026-01-01T00:00:00Z"), mk("c", "nonsense")]);
    expect(out[0].id).toBe("b");
  });
});

describe("filterCards", () => {
  const docs = [
    { id: "1", title: "Groceries" },
    { id: "2", title: "Meeting notes" },
    { id: "3", title: "Ideas" },
  ];

  it("returns everything for an empty or whitespace query", () => {
    expect(filterCards(docs, "")).toHaveLength(3);
    expect(filterCards(docs, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively on the title", () => {
    expect(filterCards(docs, "GROCER").map((d) => d.id)).toEqual(["1"]);
  });

  it("also searches the supplied haystack", () => {
    const out = filterCards(docs, "budget", (d) => (d.id === "3" ? "budget planning" : ""));
    expect(out.map((d) => d.id)).toEqual(["3"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterCards(docs, "zzzz")).toEqual([]);
  });
});

describe("partitionPinned", () => {
  it("splits pinned from the rest, preserving order", () => {
    const { pinned, others } = partitionPinned([
      { id: "a", metadata: { [CARD_PINNED_KEY]: true } },
      { id: "b", metadata: {} },
      { id: "c", metadata: { [CARD_PINNED_KEY]: true } },
    ]);
    expect(pinned.map((d) => d.id)).toEqual(["a", "c"]);
    expect(others.map((d) => d.id)).toEqual(["b"]);
  });
});

describe("composeNoteMarkdown", () => {
  it("writes the title as an H1 so title derivation names the doc", () => {
    expect(composeNoteMarkdown("Shopping", "milk")).toBe("# Shopping\n\nmilk");
  });

  it("handles a body with no title", () => {
    expect(composeNoteMarkdown("", "just a thought")).toBe("just a thought");
  });

  it("handles a title with no body", () => {
    expect(composeNoteMarkdown("Title only", "")).toBe("# Title only");
  });

  it("converts each body line to a task in checklist mode", () => {
    expect(composeNoteMarkdown("List", "milk\neggs")).not.toContain("- [ ]");
    expect(composeNoteMarkdown("List", "milk\neggs", true)).toBe(
      "# List\n\n- [ ] milk\n- [ ] eggs"
    );
  });

  it("does not double-prefix a line already written as a task", () => {
    expect(composeNoteMarkdown("", "- [x] done\nnew", true)).toBe("- [x] done\n- [ ] new");
  });

  it("drops blank lines in checklist mode", () => {
    expect(composeNoteMarkdown("", "a\n\n\nb", true)).toBe("- [ ] a\n- [ ] b");
  });

  it("collapses runs of blank lines in prose mode", () => {
    expect(composeNoteMarkdown("", "a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("trims surrounding whitespace", () => {
    expect(composeNoteMarkdown("  T  ", "  body  ")).toBe("# T\n\nbody");
  });
});

describe("isEmptyCapture", () => {
  it("is true only when both fields are blank", () => {
    expect(isEmptyCapture("", "")).toBe(true);
    expect(isEmptyCapture("   ", "\n\n")).toBe(true);
    expect(isEmptyCapture("x", "")).toBe(false);
    expect(isEmptyCapture("", "x")).toBe(false);
  });
});
