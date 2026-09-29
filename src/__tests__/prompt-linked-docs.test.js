/**
 * copyAsPrompt's linked documents are real documents.
 *
 * The integration's copyAsPrompt called the asynchronous getDocById without
 * `await`, so every linked document it formatted was a pending Promise: the
 * prompt carried empty, untitled entries for the very context it promised.
 */
import { describe, expect, it } from "vitest";
import { formatDocumentsForPrompt, linkedPromptItems } from "../integration/prompt-builder";

const doc = (id, title) => ({ id, title, canonical: { type: "doc", content: [] }, tags: [], metadata: {} });
const store = { b: doc("b", "Bravo"), c: doc("c", "Charlie") };
const getDocById = async (id) => {
  if (id === "broken") throw new Error("unreadable");
  return store[id] ?? null;
};

describe("linkedPromptItems", () => {
  it("resolves each neighbour, in both link directions, once", async () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "c", target: "a" },
      { source: "a", target: "b" },
      { source: "x", target: "y" },
    ];
    const items = await linkedPromptItems(edges, "a", getDocById);
    expect(items.map((i) => i.doc.title)).toEqual(["Bravo", "Charlie"]);
    expect(items.every((i) => !(i.doc instanceof Promise))).toBe(true);
    expect(formatDocumentsForPrompt(items)).toContain("Bravo");
  });

  it("skips a missing or unreadable document instead of failing the copy", async () => {
    const edges = [{ source: "a", target: "gone" }, { source: "a", target: "broken" }, { source: "a", target: "c" }];
    const items = await linkedPromptItems(edges, "a", getDocById);
    expect(items.map((i) => i.doc.id)).toEqual(["c"]);
  });
});
