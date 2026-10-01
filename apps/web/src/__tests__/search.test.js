import { describe, it, expect } from "vitest";
import { searchDocuments } from "../store/search";

const docs = [
  { id: "a", title: "Meeting notes", text: "Discuss the roadmap and the budget. Budget is tight." },
  { id: "b", title: "Budget plan", text: "Numbers only, no keyword here." },
  { id: "c", title: "Recipes", text: "Add salt and pepper to taste." },
];

describe("searchDocuments", () => {
  it("returns empty for a blank query", () => {
    expect(searchDocuments(docs, "")).toEqual([]);
    expect(searchDocuments(docs, "   ")).toEqual([]);
  });

  it("matches body content case-insensitively and counts occurrences", () => {
    const res = searchDocuments(docs, "budget");
    const a = res.find((r) => r.id === "a");
    expect(a).toBeTruthy();
    expect(a.count).toBe(2); // "budget" twice in doc a's body
    expect(a.snippet).not.toBeNull();
    expect(a.snippet.match.toLowerCase()).toBe("budget");
  });

  it("ranks title matches ahead of body-only matches", () => {
    const res = searchDocuments(docs, "budget");
    // doc b's title is "Budget plan" (title match) → should rank first
    expect(res[0].id).toBe("b");
    expect(res[0].titleMatch).toBe(true);
  });

  it("excludes documents with no match", () => {
    const res = searchDocuments(docs, "pepper");
    expect(res.map((r) => r.id)).toEqual(["c"]);
  });

  it("builds a snippet with surrounding context", () => {
    const [r] = searchDocuments(docs, "roadmap");
    expect(r.snippet).not.toBeNull();
    expect(r.snippet.before + r.snippet.match + r.snippet.after).toContain("roadmap");
  });

  it("honors the result limit", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      id: `d${i}`,
      title: `Doc ${i}`,
      text: "common keyword",
    }));
    expect(searchDocuments(many, "keyword", 10)).toHaveLength(10);
  });
});
