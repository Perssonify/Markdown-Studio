/**
 * A026 — ⌘S must only say "Changes saved" (and fire the host's onSave) when
 * something was actually committed.
 *
 * `saveActiveDoc` RESOLVES on a refused blank write, on an ownership abort (a
 * switch or delete landed during its pre-save read) and on a caught non-quota
 * write error. handleSave awaited it, then toasted success and called the
 * host's onSave unconditionally — so a host was told content had been saved
 * that was on no disk. The store now resolves a commit boolean.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeUncommittedSave, useDocumentStore } from "../store/documentStore";
import { createDocument } from "../store/document";

vi.mock("../store/snapshot-store", () => ({
  snapshotStore: { maybeRecordOnSave: vi.fn(), record: vi.fn(async () => null) },
}));

const canonical = (text) => text
  ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
  : { type: "doc", content: [{ type: "paragraph" }] };

function setup({ save, get } = {}) {
  const stored = createDocument({ id: "a", title: "A", canonical: canonical("stored text") });
  const adapter = {
    list: async () => [stored],
    get: get ?? (async () => ({ ...stored })),
    save: save ?? vi.fn(async () => {}),
    delete: async () => {}, search: async () => [],
    getPrefs: async () => ({}), setPrefs: async () => {},
  };
  useDocumentStore.getState().initStorage(adapter);
  useDocumentStore.setState({
    activeDoc: { ...stored }, activeDocId: "a", hydratedDocId: "a",
    saveStatus: "editing", saveError: null, _unsavedEdits: new Map(), _draftBases: new Map(),
  });
  return adapter;
}

let warn;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { useDocumentStore.getState().setDirty(); warn.mockRestore(); });

describe("A026: saveActiveDoc says whether it committed", () => {
  it("true for a write that landed", async () => {
    const adapter = setup();
    expect(await useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("new") })).toBe(true);
    expect(adapter.save).toHaveBeenCalledOnce();
  });

  it("false when the blank-over-content backstop refuses", async () => {
    const adapter = setup();
    expect(await useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("") })).toBe(false);
    expect(adapter.save).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().saveStatus).toBe("blocked");
  });

  it("false when a switch lands during the pre-save read (ownership abort)", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const adapter = setup({ get: async () => { await gate; return null; } });
    const p = useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("x") });
    useDocumentStore.setState({ activeDocId: "b", hydratedDocId: "b" });
    release();
    expect(await p).toBe(false);
    expect(adapter.save).not.toHaveBeenCalled();
  });

  it("false when a non-quota write error is swallowed", async () => {
    setup({ save: vi.fn(async () => { throw new Error("disk on fire"); }) });
    expect(await useDocumentStore.getState().saveActiveDoc({ getJSON: () => canonical("x") })).toBe(false);
    expect(useDocumentStore.getState().saveStatus).toBe("error");
  });
});

describe("what ⌘S says instead of 'Changes saved'", () => {
  it("names the reason", () => {
    expect(describeUncommittedSave({ saveStatus: "blocked", saveError: null }).message).toMatch(/Not saved/);
    expect(describeUncommittedSave({ saveStatus: "conflict", saveError: null }).message).toMatch(/another tab/);
    expect(describeUncommittedSave({ saveStatus: "error", saveError: "disk on fire" }).message).toMatch(/disk on fire/);
    expect(describeUncommittedSave({ saveStatus: "editing", saveError: null }).message).toMatch(/did not complete/);
  });
});

describe("handleSave branches on the commit (source pin)", () => {
  // handleSave lives in the editor's saving hook (src/editor/useAutosave.ts).
  const src = readFileSync(join(process.cwd(), "src/editor/useAutosave.ts"), "utf8").replace(/\r\n/g, "\n");
  const body = src.slice(src.indexOf("const handleSave = useCallback("), src.indexOf("// ── Idle autosave"));

  it("is the save the editor wires to ⌘S and the menu", () => {
    const pe = readFileSync(join(process.cwd(), "src/PerssonifyEditor.tsx"), "utf8");
    expect(pe).toMatch(/const \{ handleSave[^}]*\} = useAutosave\(/);
    expect(pe).toContain("save: handleSave");
    expect(pe).toContain("onSave={handleSave}");
  });

  it("reports success and fires onSave only after a committed write", () => {
    const committedAt = body.indexOf("const committed = await saveActiveDoc(editor)");
    const bailAt = body.indexOf("if (!committed)");
    const successAt = body.indexOf('toast.show("Changes saved"');
    const onSaveAt = body.indexOf("onSave({");
    expect(committedAt).toBeGreaterThan(-1);
    expect(bailAt).toBeGreaterThan(committedAt);
    expect(successAt).toBeGreaterThan(bailAt);
    expect(onSaveAt).toBeGreaterThan(bailAt);
    // …and the bail really returns before reaching them.
    expect(body.slice(bailAt, successAt)).toMatch(/return;/);
  });
});
