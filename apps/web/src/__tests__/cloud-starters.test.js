// The first-visit notes (app/cloud/starters.ts): recognising the copies a new
// browser seeds, so the first sign-in there does not upload them into an
// account that already has its own, and never mistaking a visitor's note for one.
import { describe, expect, it } from "vitest";
import { STARTER_FOLDERS, STARTER_TITLES, untouchedStarterIds, withoutNotes } from "../app/cloud/starters";

const at = (s) => new Date(Date.UTC(2026, 9, 13, 7, 0, 0) + s * 1000).toISOString();
const doc = (id, title, created, updated = created) => ({ id, title, created: at(created), updated: at(updated) });
// What a first visit writes: the welcome note, then the companions, within a second.
const seeded = () => [doc("w", "Markdown Studio", 0, 0.6), doc("c", "Changelog", 0.9, 0.91), doc("g", "Getting started", 1, 1.01)];

describe("the first-visit notes", () => {
  it("are known by their titles and folder", () => {
    expect([...STARTER_TITLES].sort()).toEqual(["Changelog", "Getting started", "Markdown Studio"]);
    expect([...STARTER_FOLDERS]).toEqual(["Guides"]);
  });

  it("are recognised while nobody has touched them", () => {
    expect([...untouchedStarterIds(seeded())].sort()).toEqual(["c", "g", "w"]);
  });

  it("stop being starters once edited, while the others still are", () => {
    const docs = seeded();
    docs[0] = doc("w", "Markdown Studio", 0, 600); // the welcome note, edited ten minutes later
    expect([...untouchedStarterIds(docs)].sort()).toEqual(["c", "g"]);
  });

  it("never include the visitor's own notes, even one with a starter's title", () => {
    const docs = [...seeded(), doc("mine", "My plan", 120, 400), doc("imported", "Changelog", 86_400)];
    expect([...untouchedStarterIds(docs)].sort()).toEqual(["c", "g", "w"]);
  });

  it("are not guessed when the library did not start with the welcome note", () => {
    // The welcome note was deleted, then a file called Changelog imported: it is the visitor's.
    expect(untouchedStarterIds([doc("x", "Changelog", 0)]).size).toBe(0);
    expect(untouchedStarterIds([doc("c", "Changelog", 0.9), doc("g", "Getting started", 1)]).size).toBe(0);
    expect(untouchedStarterIds([doc("a", "Notes", 0), doc("b", "Changelog", 3_600)]).size).toBe(0);
    expect(untouchedStarterIds([]).size).toBe(0);
  });
});

describe("the folder tree without the removed notes", () => {
  const tree = {
    folders: [{ id: "f-guides", name: "Guides", parentId: null }, { id: "f-work", name: "Work", parentId: null }],
    docParents: { g: "f-guides", mine: "f-work" },
    docOrder: { root: ["w", "c", "mine"], "f-guides": ["g"] },
    expanded: { "f-guides": true },
  };

  it("drops their entries and the starter folder they leave empty", () => {
    const out = withoutNotes(tree, new Set(["w", "c", "g"]));
    expect(out.folders.map((f) => f.id)).toEqual(["f-work"]);
    expect(out.docParents).toEqual({ mine: "f-work" });
    expect(out.docOrder).toEqual({ root: ["mine"], "f-guides": [] });
    expect(out.expanded).toEqual(tree.expanded);
  });

  it("keeps a starter folder the visitor filed a note in, or nested a folder under", () => {
    const filed = withoutNotes({ ...tree, docParents: { ...tree.docParents, mine: "f-guides" } }, new Set(["g"]));
    expect(filed.folders.map((f) => f.id)).toEqual(["f-guides", "f-work"]);
    const nested = withoutNotes({ ...tree, folders: [...tree.folders, { id: "f-sub", name: "Sub", parentId: "f-guides" }] }, new Set(["g"]));
    expect(nested.folders.map((f) => f.id)).toContain("f-guides");
  });

  it("leaves anything that is not a tree as it is", () => {
    expect(withoutNotes(null, new Set(["g"]))).toBeNull();
    expect(withoutNotes("x", new Set(["g"]))).toBe("x");
  });
});
