import { readFileSync } from "fs";
import { join } from "path";
import { act, fireEvent, render } from "@testing-library/react";
import React, { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useDocumentStore } from "../store/documentStore";
import { useFolderStore } from "../store/folders";
import { DialogProvider } from "../ui/DialogProvider";
import { timeAgo } from "../ui/relative-time";
import { WorkspacePanel } from "../ui/WorkspacePanel";

// Every document row calls timeAgo exactly once per render, so wrapping it in
// a counter measures ROW RENDERS without a test hook in production code.
vi.mock("../ui/relative-time", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, timeAgo: vi.fn(mod.timeAgo) };
});

/**
 * A082. The library panel froze the editor on every autosave at a few hundred
 * documents: each row mounted two Base UI menu roots, nothing was windowed or
 * memoized, and every save replaced the document list — so every row
 * re-rendered. Measured by the audit at 4× CPU: ~1s per save at 500 documents,
 * 3.8s at 2,000.
 *
 * Measured here in jsdom (this harness, same machine), v1.77.0 → now:
 *   500 docs:   13,052 elements, 500 treeitems, save 385ms wall / 291ms commit
 *               →   807 elements,  29 treeitems, save  15ms wall /  12ms commit
 *   2,000 docs: 52,052 elements, 2,000 treeitems, save 2,266ms / 1,231ms
 *               →   807 elements,  29 treeitems, save  16ms wall /  12ms commit
 * Timing is LOGGED, never asserted (wall-clock varies run to run); what is
 * asserted is the structure that produces it: the DOM stays a window, and a
 * save re-renders the one row that changed.
 */

const dialogApi = {
  confirm: async () => true,
  prompt: async () => null,
  equation: async () => null,
  confirmUnsaved: async () => "cancel",
};
const noop = () => {};
const BASE = Date.parse("2026-09-01T00:00:00Z");

/** Fresh summary objects every call — exactly what storage.list() returns on
 *  every save. `bump` gives one document a newer `updated` and word count. */
function makeDocs(n, bump = null) {
  return Array.from({ length: n }, (_, i) => ({
    id: `doc-${i}`,
    title: `Note ${i}`,
    updated: new Date(BASE + i * 1000 + (i === bump?.index ? bump.by : 0)).toISOString(),
    created: new Date(BASE).toISOString(),
    wordCount: 100 + i + (i === bump?.index ? 1 : 0),
    tags: [],
    hasResiduals: false,
    originFormat: "md",
  }));
}

function mount(n) {
  useFolderStore.setState({ folders: [], docParents: {}, docOrder: {}, expanded: {}, lastCreatedFolderId: null });
  const docs = makeDocs(n);
  useDocumentStore.setState({ documents: docs, activeDocId: docs[n - 1].id });
  const commits = [];
  const onRender = (_id, phase, actualDuration) => commits.push({ phase, actualDuration });
  const t0 = performance.now();
  const utils = render(
    <DialogProvider value={dialogApi}>
      <TooltipProvider>
        <Profiler id="panel" onRender={onRender}>
          <WorkspacePanel
            tab="files" onTabChange={noop} onClose={noop} width={320} onResize={noop}
            onSelect={noop} onNew={noop} onDelete={noop} onRename={noop} onDuplicate={noop}
            headings={[]} activeIndex={null} onNavigateHeading={noop}
          />
        </Profiler>
      </TooltipProvider>
    </DialogProvider>
  );
  return { ...utils, commits, mountMs: performance.now() - t0 };
}

beforeEach(() => { vi.mocked(timeAgo).mockClear(); });
afterEach(() => {
  useDocumentStore.setState({ documents: [], activeDocId: null });
});

describe("A082 — the library does not grow with the library", () => {
  for (const n of [500, 2000]) {
    it(`mounts a WINDOW of rows at ${n} documents, and saves stay cheap`, () => {
      const { container, commits, mountMs } = mount(n);
      const treeitems = container.querySelectorAll('[role="treeitem"]').length;
      const elements = container.querySelectorAll("*").length;
      // A window (the fallback viewport plus overscan), not the library.
      expect(treeitems).toBeGreaterThan(5);
      expect(treeitems).toBeLessThan(60);
      expect(elements).toBeLessThan(2000);

      const saves = [];
      for (let k = 0; k < 5; k++) {
        commits.length = 0;
        const t0 = performance.now();
        act(() => { useDocumentStore.setState({ documents: makeDocs(n, { index: n - 1, by: (k + 1) * 1000 }) }); });
        saves.push({ wall: performance.now() - t0, commit: commits.reduce((s, c) => s + c.actualDuration, 0) });
      }
      const med = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      console.log(`[A082] n=${n} mount=${mountMs.toFixed(0)}ms treeitems=${treeitems} elements=${elements} ` +
        `save(wall median)=${med(saves.map((s) => s.wall)).toFixed(1)}ms save(commit median)=${med(saves.map((s) => s.commit)).toFixed(1)}ms`);
    }, 120_000);
  }

  it("re-renders ONLY the row that changed when a save replaces the list", () => {
    mount(500);
    vi.mocked(timeAgo).mockClear();
    // The open document is the newest, so an autosave changes its `updated`
    // and word count without moving it — the everyday case while typing.
    act(() => { useDocumentStore.setState({ documents: makeDocs(500, { index: 499, by: 5000 }) }); });
    expect(vi.mocked(timeAgo)).toHaveBeenCalledTimes(1);
  });

  it("windows the flat SELECT list too — it shows every document", () => {
    const { getByLabelText, container } = mount(2000);
    act(() => { fireEvent.click(getByLabelText("Select documents")); });
    const options = container.querySelectorAll('[role="option"]').length;
    expect(options).toBeGreaterThan(5);
    expect(options).toBeLessThan(60);
  });
});

describe("A082 — one shared row menu per list, mounted on open", () => {
  const code = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("rows carry detached triggers; ONE root per list", () => {
    const tree = code("src/ui/FolderTree.tsx");
    // The row components render no menu ROOT of either kind…
    const rowsSrc = tree.slice(tree.indexOf("const FolderRow = React.memo"), tree.indexOf("export function FolderTree"));
    expect(rowsSrc).not.toMatch(/<DropdownMenu[\s>]/);
    expect(rowsSrc).not.toMatch(/<ContextMenu[\s>]/);
    expect(rowsSrc).toContain("handle={handlers.menuHandle}");
    // …and the tree renders exactly one of each.
    expect(tree.match(/<DropdownMenu handle=/g)).toHaveLength(1);
    expect(tree.match(/<ContextMenu /g)).toHaveLength(1);
    const panel = code("src/ui/WorkspacePanel.tsx");
    expect(panel.match(/<DropdownMenu handle=/g)).toHaveLength(1);
  });

  it("opens the shared menu for the row whose ⋮ was pressed", async () => {
    const { container, findByText } = mount(30);
    const trigger = container.querySelector('[data-key="d:doc-12"] [aria-label="Options for Note 12"]');
    expect(trigger).not.toBeNull();
    await act(async () => { fireEvent.click(trigger); });
    // The body is the shared one, rendered for THIS row: Rename opens its box.
    const rename = await findByText("Rename");
    await act(async () => { fireEvent.click(rename); });
    const input = container.querySelector('[data-key="d:doc-12"] input');
    expect(input).not.toBeNull();
    expect(input.value).toBe("Note 12");
  });

  it("defers the search filter so typing never waits for the whole library", () => {
    // Not observable in jsdom — act() flushes deferred renders synchronously —
    // so this is a source pin, like the other scheduling pins in this repo.
    const panel = code("src/ui/WorkspacePanel.tsx");
    expect(panel).toContain("const query = useDeferredValue(filter);");
    expect(panel).toMatch(/const q = query\.toLowerCase\(\);/);
  });
});
