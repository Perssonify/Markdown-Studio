import { describe, expect, it } from "vitest";
import { CONSOLE_COMMANDS, runConsoleCommand } from "../store/console-commands.ts";

// A fake read-only context — the registry must only touch these accessors.
const ctx = {
  getLifecycleState: () => ({
    activeDocId: "doc-a",
    hydratedDocId: "doc-a",
    hydrated: true,
    saveStatus: "ready",
    hasActiveDoc: true,
    unsavedDraftCount: 0,
    docCount: 2,
  }),
  getStorageMetrics: () => ({ usedBytes: 2048, maxBytes: 1024 * 1024, pct: 0, docCount: 2, available: 1024 * 1024 - 2048 }),
  listDocuments: () => [
    { id: "doc-a", title: "Alpha" },
    { id: "doc-b", title: "Beta" },
  ],
  getActiveDocId: () => "doc-a",
  getActiveOutline: () => [
    { level: 1, text: "Title" },
    { level: 2, text: "Section" },
  ],
  getLinks: () => ({
    backlinks: [{ id: "doc-b", title: "Beta" }],
    forwardLinks: [],
  }),
  getGraph: () => ({ nodes: [1, 2, 3], edges: [1] }),
};

describe("console command registry", () => {
  it("help lists every registered command", () => {
    const r = runConsoleCommand("help", ctx);
    expect(r.ok).toBe(true);
    for (const name of Object.keys(CONSOLE_COMMANDS)) {
      expect(r.output).toContain(name);
    }
  });

  it("rejects unknown commands (no eval fallback)", () => {
    const r = runConsoleCommand("rm -rf /", ctx);
    expect(r.ok).toBe(false);
    expect(r.output).toMatch(/unknown command/i);
  });

  it("diag.lifecycle reports the lifecycle snapshot", () => {
    const r = runConsoleCommand("diag.lifecycle", ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("\"activeDocId\": \"doc-a\"");
    expect(r.output).toContain("\"hydrated\": true");
  });

  it("diag.storage humanizes byte counts", () => {
    const r = runConsoleCommand("diag.storage", ctx);
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/2\.0 KB/);
    expect(r.output).toContain("documents: 2");
  });

  it("docs.list shows every document", () => {
    const r = runConsoleCommand("docs.list", ctx);
    expect(r.output).toContain("Alpha");
    expect(r.output).toContain("Beta");
    expect(r.output).toContain("2 document(s)");
  });

  it("doc.outline indents by heading level", () => {
    const r = runConsoleCommand("doc.outline", ctx);
    expect(r.output).toContain("H1 Title");
    expect(r.output).toContain("H2 Section");
  });

  it("doc.links summarizes backlinks and forward links", () => {
    const r = runConsoleCommand("doc.links", ctx);
    expect(r.output).toContain("Backlinks (1)");
    expect(r.output).toContain("Beta");
    expect(r.output).toContain("Forward links (0)");
  });

  it("graph.stats counts nodes and edges", () => {
    const r = runConsoleCommand("graph.stats", ctx);
    expect(r.output).toContain("nodes: 3");
    expect(r.output).toContain("edges: 1");
  });

  it("reports no active document when there is none", () => {
    const empty = { ...ctx, getActiveDocId: () => null };
    expect(runConsoleCommand("doc.outline", empty).ok).toBe(false);
    expect(runConsoleCommand("doc.links", empty).ok).toBe(false);
  });

  it("trims whitespace and ignores an empty line", () => {
    expect(runConsoleCommand("   ", ctx).ok).toBe(false);
    expect(runConsoleCommand("  help  ", ctx).ok).toBe(true);
  });
});
