import { describe, expect, it } from "vitest";
import { docSearchText, docSearchTextLower } from "../store/documents/doc-text";

/**
 * The library filter's text source. It memoizes per document, keyed by
 * `updated` — which makes a stale-cache bug the interesting failure: a search
 * that keeps matching text the user has already deleted, or stops matching text
 * they just typed. Nothing tested that key.
 */

const doc = (id, text, updated) => ({
  id,
  updated,
  canonical: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  },
});

describe("docSearchText", () => {
  it("prefers the cached markdown when there is one", () => {
    const d = { ...doc("a1", "canonical text", "t1"), markdownCache: "# markdown text" };
    expect(docSearchText(d)).toBe("# markdown text");
  });

  it("falls back to the canonical when the markdown cache is empty", () => {
    for (const cache of [null, undefined, ""]) {
      const d = { ...doc("a2", "from canonical", "t1"), markdownCache: cache };
      expect(docSearchText(d)).toContain("from canonical");
    }
  });

  it("returns the same text for an unchanged document", () => {
    const d = doc("b1", "stable body", "t1");
    expect(docSearchText(d)).toBe(docSearchText(d));
  });

  it("re-reads when `updated` moves — a stale hit would search deleted text", () => {
    expect(docSearchText(doc("b2", "before the edit", "t1"))).toContain("before the edit");
    expect(docSearchText(doc("b2", "after the edit", "t2"))).toContain("after the edit");
  });

  it("keys the cache per document, not globally", () => {
    docSearchText(doc("c1", "document one", "t1"));
    expect(docSearchText(doc("c2", "document two", "t1"))).toContain("document two");
    expect(docSearchText(doc("c1", "document one", "t1"))).toContain("document one");
  });

  it("survives a document with no canonical at all", () => {
    expect(docSearchText({ id: "d1", updated: "t1" })).toBe("");
  });
});

describe("docSearchTextLower", () => {
  it("lower-cases the body", () => {
    expect(docSearchTextLower(doc("e1", "MiXeD Case BODY", "t1"))).toBe(
      docSearchText(doc("e1", "MiXeD Case BODY", "t1")).toLowerCase()
    );
  });

  it("re-lowers when the document changes", () => {
    expect(docSearchTextLower(doc("e2", "FIRST", "t1"))).toContain("first");
    expect(docSearchTextLower(doc("e2", "SECOND", "t2"))).toContain("second");
    expect(docSearchTextLower(doc("e2", "SECOND", "t2"))).not.toContain("first");
  });

  it("re-lowers a markdown-cache document when its cache changes", () => {
    // `docSearchText` returns from `markdownCache` BEFORE consulting the cache,
    // so it never invalidates the entry the lower-case memo seeded. Only the
    // signature check in this function catches the change — drop it and the
    // library search keeps matching the previous revision of the note.
    const base = { ...doc("e3", "unused", "t1"), markdownCache: "# FIRST Heading" };
    expect(docSearchTextLower(base)).toBe("# first heading");
    const edited = { ...base, updated: "t2", markdownCache: "# SECOND Heading" };
    expect(docSearchTextLower(edited)).toBe("# second heading");
  });

  // NOTE: the `cache.set` in the lower-case path only affects the HIT RATE for
  // markdown-cache documents (the value is identical either way), and the cache
  // is module-private, so nothing here can hold it. It is a perf detail, not
  // tested behaviour.

  it("agrees with docSearchText in either call order", () => {
    const d1 = doc("f1", "Order Independent", "t1");
    expect(docSearchTextLower(d1)).toBe(docSearchText(d1).toLowerCase());
    const d2 = doc("f2", "Order Independent", "t1");
    expect(docSearchText(d2).toLowerCase()).toBe(docSearchTextLower(d2));
  });
});
