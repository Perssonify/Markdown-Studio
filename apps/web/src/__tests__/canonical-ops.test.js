import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  htmlToCanonical,
  asCanonicalDoc,
  appendHtmlToCanonical,
} from "../store/documents/canonical-ops";

// A Tiptap schema, which is what these helpers receive in the app. (The test
// used prosemirror's basic schema via `@tiptap/pm/schema-basic`; Tiptap 3.31's
// `@tiptap/pm` no longer ships that subpath.)
const schema = getSchema([StarterKit]);

describe("canonical-ops", () => {
  it("asCanonicalDoc normalizes non-doc values to an empty doc", () => {
    expect(asCanonicalDoc(null)).toEqual({ type: "doc", content: [] });
    expect(asCanonicalDoc({})).toEqual({ type: "doc", content: [] });
    expect(asCanonicalDoc({ type: "doc", content: [{ type: "paragraph" }] })).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("htmlToCanonical parses HTML into a doc node using the given schema", () => {
    const doc = htmlToCanonical("<p>hello</p>", schema);
    expect(doc.type).toBe("doc");
    expect(Array.isArray(doc.content)).toBe(true);
    expect(doc.content[0].type).toBe("paragraph");
  });

  it("appendHtmlToCanonical concatenates parsed content onto an existing doc", () => {
    const existing = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] };
    const merged = appendHtmlToCanonical(existing, "<p>two</p>", schema);
    expect(merged.type).toBe("doc");
    // original block preserved, new block appended at the end
    expect(merged.content.length).toBe(2);
    expect(merged.content[0].content[0].text).toBe("one");
    expect(merged.content[1].type).toBe("paragraph");
  });

  it("appendHtmlToCanonical treats a missing/invalid base as empty", () => {
    const merged = appendHtmlToCanonical(null, "<p>only</p>", schema);
    expect(merged.content.length).toBe(1);
    expect(merged.content[0].type).toBe("paragraph");
  });
});
