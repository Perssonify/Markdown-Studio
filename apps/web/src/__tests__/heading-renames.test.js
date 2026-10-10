/**
 * Renaming a heading keeps the links to it working (backlog #122) — the pure
 * half: which headings were renamed (store/links/heading-renames.ts), which links
 * point at them, and the rewrite in a stored canonical and as a transaction
 * on a live editor state. The editor's side is behave-heading-renames.test.jsx.
 */
import { describe, expect, it } from "vitest";
import { Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { headlessSchema } from "../engine/serialize-doc";
import { createWikiResolver } from "../store/links/link-index";
import { findHeadingByAnchor } from "../store/documents/doc-outline";
import {
  alignHeadingRenames,
  buildHeadingLinkTransaction,
  countHeadingLinks,
  headingAnchorKey,
  headingsFromCanonical,
  headingsFromDoc,
  isLinkableAnchor,
  rebaselineHeadings,
  renameTable,
  rewriteHeadingLinks,
} from "../store/links/heading-renames";

const h = (level, text) => ({ level, text });
const renamesOf = (before, after) => alignHeadingRenames(before, after).map((r) => `${r.oldText} → ${r.newText}`);

describe("alignHeadingRenames — which headings were renamed", () => {
  it("finds a rename among unchanged headings", () => {
    expect(renamesOf(
      [h(1, "Guide"), h(2, "Setup"), h(2, "Usage")],
      [h(1, "Guide"), h(2, "Installation"), h(2, "Usage")],
    )).toEqual(["Setup → Installation"]);
  });

  it("is not thrown off by headings inserted and deleted around the rename", () => {
    // B deleted, D renamed: the unchanged headings are fixed points, so B's
    // deletion does not shift D's pairing onto C.
    expect(renamesOf(
      [h(1, "A"), h(2, "B"), h(2, "C"), h(2, "D"), h(2, "E")],
      [h(1, "A"), h(2, "C"), h(2, "D renamed"), h(2, "E")],
    )).toEqual(["D → D renamed"]);
    // Inserted before, deleted after.
    expect(renamesOf(
      [h(1, "A"), h(2, "C"), h(2, "D"), h(2, "Gone")],
      [h(1, "A"), h(2, "New one"), h(2, "C"), h(3, "Sub"), h(2, "D renamed")],
    )).toEqual(["D → D renamed"]);
    expect(renamesOf(
      [h(1, "A"), h(2, "B"), h(2, "C"), h(2, "D")],
      [h(1, "A"), h(2, "Inserted"), h(2, "B"), h(2, "C prime"), h(2, "D")],
    )).toEqual(["C → C prime"]);
    // Two renames in one gap pair in order.
    expect(renamesOf(
      [h(1, "A"), h(2, "One"), h(2, "Two"), h(1, "Z")],
      [h(1, "A"), h(2, "Uno"), h(2, "Dos"), h(1, "Z")],
    )).toEqual(["One → Uno", "Two → Dos"]);
  });

  it("never pairs headings of different levels", () => {
    expect(renamesOf([h(1, "T"), h(2, "Setup")], [h(1, "T"), h(3, "Install")])).toEqual([]);
    expect(renamesOf(
      [h(1, "T"), h(2, "Setup"), h(2, "Usage")],
      [h(1, "T"), h(3, "Install"), h(2, "Usage")],
    )).toEqual([]);
    // In order: the H3 is skipped as an insertion and the H2 still pairs.
    expect(renamesOf(
      [h(1, "T"), h(2, "Setup"), h(1, "End")],
      [h(1, "T"), h(3, "Aside"), h(2, "Install"), h(1, "End")],
    )).toEqual(["Setup → Install"]);
  });

  it("offers nothing while the old anchor still exists — the links still resolve", () => {
    // A duplicate "Notes" survives, so [[Doc#Notes]] still finds a heading.
    expect(renamesOf([h(2, "Notes"), h(2, "Notes")], [h(2, "Notes"), h(2, "Todo")])).toEqual([]);
    // Moved elsewhere in the document: not a rename either.
    expect(renamesOf([h(2, "Setup"), h(2, "Usage")], [h(2, "Install"), h(2, "Usage"), h(3, "Setup")])).toEqual([]);
  });

  it("follows the heading a link resolves to — the FIRST with its anchor", () => {
    // Both renamed: [[Doc#Notes]] went to the first, so only it moves the links.
    expect(renamesOf([h(2, "Notes"), h(2, "X"), h(2, "Notes")], [h(2, "Alpha"), h(2, "X"), h(2, "Beta")]))
      .toEqual(["Notes → Alpha"]);
    // Renamed onto an EARLIER heading's name: a retargeted link would land there.
    expect(renamesOf([h(2, "Intro"), h(2, "Setup")], [h(2, "Intro"), h(2, "Intro")])).toEqual([]);
  });

  it("treats case, punctuation and spacing changes as the same anchor", () => {
    expect(renamesOf([h(2, "Setup")], [h(2, "setup:")])).toEqual([]);
    expect(renamesOf([h(2, "Part 1 — Setup")], [h(2, "Part 1: Setup")])).toEqual([]);
  });

  it("handles non-Latin headings (the anchor keeps every script)", () => {
    expect(renamesOf([h(2, "Заключение"), h(2, "東京")], [h(2, "Итоги"), h(2, "東京")])).toEqual(["Заключение → Итоги"]);
    // Emoji-only headings compare on their exact text.
    expect(renamesOf([h(2, "🎉")], [h(2, "🎊")])).toEqual(["🎉 → 🎊"]);
  });

  it("never offers a new text a link cannot carry", () => {
    expect(isLinkableAnchor("A | B")).toBe(false);
    expect(isLinkableAnchor("[draft]")).toBe(false);
    expect(isLinkableAnchor("   ")).toBe(false);
    expect(isLinkableAnchor("C# & F#")).toBe(true);
    expect(renamesOf([h(2, "Setup")], [h(2, "Setup | Install")])).toEqual([]);
    expect(renamesOf([h(2, "Setup")], [h(2, "")])).toEqual([]);
  });

  it("gives up on a comparison too large to be a rename", () => {
    const before = Array.from({ length: 600 }, (_, i) => h(2, `old ${i}`));
    const after = Array.from({ length: 600 }, (_, i) => h(2, `new ${i}`));
    expect(alignHeadingRenames(before, after)).toEqual([]);
  });

  it("rebaselines exactly the offered renames", () => {
    const base = [h(1, "T"), h(2, "Setup"), h(2, "Usage")];
    const next = rebaselineHeadings(base, [{ oldText: "setup", newText: "Install" }]);
    expect(next).toEqual([h(1, "T"), h(2, "Install"), h(2, "Usage")]);
    expect(base[1].text).toBe("Setup"); // not mutated
    // Once rebaselined, the same rename is not found again; another still is.
    expect(renamesOf(next, [h(1, "T"), h(2, "Install"), h(2, "Use")])).toEqual(["Usage → Use"]);
  });
});

describe("heading lists", () => {
  const schema = headlessSchema();
  const doc = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      { type: "blockquote", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Quoted" }] }] },
      { type: "bulletList", content: [{ type: "listItem", content: [
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "In " }, { type: "text", marks: [{ type: "bold" }], text: "a list" }] },
      ] }] },
      { type: "heading", attrs: { level: 2 } },
      { type: "paragraph", content: [{ type: "text", text: "# not a heading" }] },
    ],
  };

  it("reads the same headings from the canonical and from the live document", () => {
    const expected = [h(1, "Title"), h(2, "Quoted"), h(3, "In a list"), h(2, "")];
    expect(headingsFromCanonical(doc)).toEqual(expected);
    expect(headingsFromDoc(PMNode.fromJSON(schema, doc))).toEqual(expected);
  });
});

// ─── The links ───────────────────────────────────────────────────────────────

const schema = headlessSchema();
/** Normalise hand-written JSON to what the editor stores (every mark attr). */
const norm = (json) => PMNode.fromJSON(schema, json).toJSON();
const wiki = (docLink, anchor) => ({ type: "link", attrs: { href: "#", class: "wiki-link", docLink, anchor } });
const text = (t, ...marks) => (marks.length ? { type: "text", text: t, marks } : { type: "text", text: t });
const p = (...content) => ({ type: "paragraph", content });
const docOf = (...blocks) => norm({ type: "doc", content: blocks });

const library = [
  { id: "guide", title: "Guide" },
  { id: "notes", title: "Notes" },
  { id: "c", title: "C" },
  { id: "ctips", title: "C# Tips" },
];
const resolve = createWikiResolver(library);
const scope = (sourceDocId, renames, subjectDocId = "guide") => ({
  sourceDocId, subjectDocId, resolve, renames: renameTable(renames),
});
const SETUP = [{ oldText: "Setup", newText: "Installation" }];

/** Every link mark in a canonical, as `text|docLink#anchor`. */
function marksOf(canonical) {
  const out = [];
  const walk = (n) => {
    const m = n.marks?.find((x) => x.type === "link");
    if (m) out.push(`${n.text}|${m.attrs.docLink}#${m.attrs.anchor}`);
    (n.content ?? []).forEach(walk);
  };
  walk(canonical);
  return out;
}
const textsOf = (canonical) => {
  const out = [];
  const walk = (n) => { if (n.text) out.push(n.text); (n.content ?? []).forEach(walk); };
  walk(canonical);
  return out.join("");
};

describe("rewriteHeadingLinks — rendered link marks", () => {
  it("retargets a link to the renamed heading and, when its text is the default, the text too", () => {
    const b = docOf(p(text("Guide#Setup", wiki("Guide", "Setup"))));
    const { canonical, count } = rewriteHeadingLinks(b, scope("notes", SETUP));
    expect(count).toBe(1);
    expect(marksOf(canonical)).toEqual(["Guide#Installation|Guide#Installation"]);
    // The link now resolves, and to a heading that exists.
    const m = canonical.content[0].content[0].marks[0];
    const r = resolve(m.attrs.docLink, m.attrs.anchor);
    expect(r).toEqual({ id: "guide", anchor: "Installation" });
    expect(findHeadingByAnchor(["Guide", "Installation"], r.anchor)).toBe(1);
  });

  it("keeps an alias's text — only the target moves", () => {
    const b = docOf(p(text("the setup steps", wiki("Guide", "Setup"))));
    const { canonical, count } = rewriteHeadingLinks(b, scope("notes", SETUP));
    expect(count).toBe(1);
    expect(marksOf(canonical)).toEqual(["the setup steps|Guide#Installation"]);
  });

  it("counts a link whose text is partly formatted once, and keeps that text", () => {
    const link = wiki("Guide", "Setup");
    const b = docOf(p(text("Guide#", link), text("Setup", link, { type: "bold" })));
    expect([...countHeadingLinks(b, scope("notes", SETUP)).values()]).toEqual([1]);
    const { canonical } = rewriteHeadingLinks(b, scope("notes", SETUP));
    // Formatted text is an alias to the turndown rule, so it is left as written.
    expect(marksOf(canonical)).toEqual(["Guide#|Guide#Installation", "Setup|Guide#Installation"]);
    expect(canonical.content[0].content[1].marks.map((m) => m.type)).toEqual(["link", "bold"]);
  });

  it("matches the anchor the way a click does: NFKC, case and punctuation insensitive", () => {
    for (const anchor of ["setup", "SETUP", "Ｓｅｔｕｐ", " Setup: "]) {
      const b = docOf(p(text("x", wiki("guide", anchor))));
      expect(rewriteHeadingLinks(b, scope("notes", SETUP)).count, anchor).toBe(1);
    }
  });

  it("leaves links to other headings, other documents and whole titles alone", () => {
    const b = docOf(
      p(text("Guide#Usage", wiki("Guide", "Usage"))),
      // "Setup" in a DIFFERENT document.
      p(text("Notes#Setup", wiki("Notes", "Setup"))),
      // A document with no anchor at all.
      p(text("Guide", wiki("Guide", null))),
      // A plain external link.
      p(text("site", { type: "link", attrs: { href: "https://example.com" } })),
    );
    const { canonical, count } = rewriteHeadingLinks(b, scope("notes", SETUP));
    expect(count).toBe(0);
    expect(canonical).toBe(b);
    // `[[C# Tips]]` names the document "C# Tips", not heading "Tips" of "C".
    const c = docOf(p(text("C# Tips", wiki("C", "Tips"))));
    expect(rewriteHeadingLinks(c, scope("notes", [{ oldText: "Tips", newText: "Hints" }], "c")).count).toBe(0);
  });

  it("retargets same-document anchors only in the renamed document", () => {
    const own = docOf(p(text("#Setup", wiki("", "Setup"))), p(text("the steps", wiki("", "setup"))));
    const { canonical, count } = rewriteHeadingLinks(own, scope("guide", SETUP));
    expect(count).toBe(2);
    expect(marksOf(canonical)).toEqual(["#Installation|#Installation", "the steps|#Installation"]);
    // In another document, [[#Setup]] means THAT document's heading.
    expect(rewriteHeadingLinks(own, scope("notes", SETUP)).count).toBe(0);
  });

  it("finds links nested in lists, quotes, tables and headings — never in code", () => {
    const link = () => text("Guide#Setup", wiki("Guide", "Setup"));
    const b = docOf(
      { type: "bulletList", content: [{ type: "listItem", content: [p(link())] }] },
      { type: "blockquote", content: [p(link())] },
      { type: "heading", attrs: { level: 2 }, content: [link()] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p(link())] }] }] },
      { type: "codeBlock", content: [{ type: "text", text: "[[Guide#Setup]]" }] },
      p(text("[[Guide#Setup]]", { type: "code" })),
    );
    const { canonical, count } = rewriteHeadingLinks(b, scope("notes", SETUP));
    expect(count).toBe(4);
    expect(textsOf(canonical)).not.toMatch(/Guide#Setup(?!\]\])/);
    expect(textsOf(canonical).match(/\[\[Guide#Setup\]\]/g)).toHaveLength(2); // the two code samples
  });

  it("does not mutate its input", () => {
    const b = docOf(p(text("Guide#Setup", wiki("Guide", "Setup")), text(" and [[Guide#Setup]]")));
    const before = JSON.stringify(b);
    rewriteHeadingLinks(b, scope("notes", SETUP));
    expect(JSON.stringify(b)).toBe(before);
  });
});

describe("rewriteHeadingLinks — literal [[…]] text", () => {
  it("rewrites the anchor and keeps target, alias and separator as written", () => {
    const b = docOf(p(text("See [[Guide#Setup]], [[Guide#setup|the steps]], [[Guide#Setup\\|cell]] and [[Guide#Usage]].")));
    const { canonical, count } = rewriteHeadingLinks(b, scope("notes", SETUP));
    expect(count).toBe(3);
    expect(textsOf(canonical)).toBe(
      "See [[Guide#Installation]], [[Guide#Installation|the steps]], [[Guide#Installation\\|cell]] and [[Guide#Usage]].",
    );
  });

  it("rewrites [[#Heading]] only in the renamed document", () => {
    const own = docOf(p(text("Jump to [[#Setup]] or [[#Setup|there]]")));
    expect(textsOf(rewriteHeadingLinks(own, scope("guide", SETUP)).canonical))
      .toBe("Jump to [[#Installation]] or [[#Installation|there]]");
    expect(rewriteHeadingLinks(own, scope("notes", SETUP)).count).toBe(0);
  });

  it("leaves [[…]] inside another link's text alone, as the link index does", () => {
    const b = docOf(p(text("[[Guide#Setup]]", { type: "link", attrs: { href: "https://example.com" } })));
    expect(rewriteHeadingLinks(b, scope("notes", SETUP)).count).toBe(0);
  });

  it("keeps the text's own formatting", () => {
    const b = docOf(p(text("[[Guide#Setup]]", { type: "italic" })));
    const { canonical } = rewriteHeadingLinks(b, scope("notes", SETUP));
    expect(canonical.content[0].content[0]).toMatchObject({ text: "[[Guide#Installation]]", marks: [{ type: "italic" }] });
  });

  it("handles non-Latin headings", () => {
    const rename = [{ oldText: "Заключение", newText: "Итоги" }];
    const b = docOf(p(text("[[Guide#заключение]]")), p(text("x", wiki("Guide", "ЗАКЛЮЧЕНИЕ"))));
    const { canonical, count } = rewriteHeadingLinks(b, scope("notes", rename));
    expect(count).toBe(2);
    expect(textsOf(canonical)).toBe("[[Guide#Итоги]]x");
    expect(marksOf(canonical)).toEqual(["x|Guide#Итоги"]);
  });

  it("counts per renamed heading", () => {
    const renames = [{ oldText: "Setup", newText: "Installation" }, { oldText: "Usage", newText: "Use" }];
    const b = docOf(p(text("[[Guide#Setup]] [[Guide#Usage]] [[Guide#Usage]]")));
    const counts = countHeadingLinks(b, scope("notes", renames));
    expect(Object.fromEntries(counts)).toEqual({ [headingAnchorKey("Setup")]: 1, [headingAnchorKey("Usage")]: 2 });
  });
});

describe("buildHeadingLinkTransaction — the live editor", () => {
  const b = docOf(
    { type: "heading", attrs: { level: 1 }, content: [text("Notes")] },
    p(text("before "), text("Guide#Setup", wiki("Guide", "Setup")), text(" after")),
    p(text("untouched paragraph")),
    p(text("alias", wiki("Guide", "Setup")), text(" and [[Guide#Setup|x]]")),
  );

  it("produces exactly the canonical rewrite, as one transaction", () => {
    const state = EditorState.create({ schema, doc: PMNode.fromJSON(schema, b) });
    const built = buildHeadingLinkTransaction(state, scope("notes", SETUP));
    expect(built.count).toBe(3);
    const after = state.apply(built.tr).doc.toJSON();
    expect(after).toEqual(rewriteHeadingLinks(b, scope("notes", SETUP)).canonical);
  });

  it("replaces only the link, so a caret beside it stays where it was", () => {
    let state = EditorState.create({ schema, doc: PMNode.fromJSON(schema, b) });
    // In "before |" — the same paragraph as the link, ahead of it. Replacing
    // the paragraph's whole content would carry the caret to its end.
    const pos = state.doc.content.child(0).nodeSize + 1 + 3;
    state = state.apply(state.tr.setSelection(state.selection.constructor.near(state.doc.resolve(pos))));
    const next = state.apply(buildHeadingLinkTransaction(state, scope("notes", SETUP)).tr);
    expect(next.selection.$from.parent.textContent).toBe("before Guide#Installation after");
    expect(next.selection.$from.parentOffset).toBe(3);
  });

  it("is null when nothing points at a renamed heading", () => {
    const state = EditorState.create({ schema, doc: PMNode.fromJSON(schema, docOf(p(text("[[Guide#Usage]]")))) });
    expect(buildHeadingLinkTransaction(state, scope("notes", SETUP))).toBeNull();
  });
});
