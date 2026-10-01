/**
 * A108 — booting over a library the BROWSER emptied (A017), through the real
 * editor: this origin's canary remembers documents that storage no longer
 * holds. The editor must not dress the loss up as a first visit — no starter
 * documents — and must say what happened and offer a way back: importing a
 * backup restores the library and retires the notice.
 *
 * One mount; the cases are one journey (see behave-harness.jsx).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react/pure";
import {
  act, fireEvent, installBrowserStubs, mountEditor, onDisk, seededAdapter, store, textOf, tick, until,
  untilHydrated,
} from "./behave-harness";
import { buildZip } from "../store/archive";
import { CANARY_KEY } from "../store/storage-durability";

vi.setConfig({ testTimeout: 30000 });

let adapter;
let warn;
let err;

beforeAll(async () => {
  installBrowserStubs();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  // This browser last saw three documents here, a day ago.
  localStorage.setItem(CANARY_KEY, JSON.stringify({ count: 3, at: Date.now() - 24 * 3600 * 1000 }));
  adapter = await seededAdapter([]);
  await mountEditor({
    storageAdapter: adapter,
    durabilityNotices: true,
    initialDocument: { title: "Welcome", content: "# Welcome\n\nfirst-run text" },
    starterDocuments: [{ markdown: "# Changelog\n\nnews" }],
  });
}, 30000);

afterAll(() => { cleanup(); warn.mockRestore(); err.mockRestore(); });

const notice = () => [...document.querySelectorAll('[role="status"]')].find((n) => /library here is empty/.test(n.textContent));

describe("a library the browser emptied", () => {
  it("is NOT greeted as a first visit, and the notice says what happened", async () => {
    const shown = await until(() => notice(), "the wiped-library notice");
    expect(shown.textContent).toContain("This browser held 3 documents on this site");
    await tick(300);
    expect(await adapter.list()).toEqual([]);        // nothing seeded over the evidence
    expect(store().documents).toEqual([]);
    expect(document.body.textContent).toContain("No document open");
  });

  it("Import a backup… restores the library and retires the notice", async () => {
    const envelope = (id, title, text) => JSON.stringify({
      _format: "perssonify-document", _version: "1.1.0", schemaVersion: 1, id, title,
      canonical: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
      origin: null, residuals: [], ingestReport: null, metadata: {}, tags: [],
      created: "2026-01-01T00:00:00.000Z", updated: "2026-01-02T00:00:00.000Z",
    });
    const zip = buildZip({
      "One.json": envelope("one", "One", "first restored"),
      "Two.json": envelope("two", "Two", "second restored"),
    });
    const input = notice().querySelector('input[type="file"]');
    await act(async () => {
      Object.defineProperty(input, "files", { value: [new File([zip], "perssonify-backup.zip")], configurable: true });
      fireEvent.change(input);
    });
    await until(async () => (await adapter.list()).length === 2, "the restored documents");
    expect(textOf((await onDisk(adapter, "one")).canonical)).toContain("first restored");
    await untilHydrated("one");
    await until(() => !notice(), "the notice to retire");
    expect(JSON.parse(localStorage.getItem(CANARY_KEY)).count).toBe(2);
  });
});

describe("Start fresh", () => {
  it("is the explicit way to accept an empty library", async () => {
    // Simulate the wipe again for this origin, as a later visit would find it.
    const { noteLibraryAtBoot } = await import("../store/storage-durability");
    localStorage.setItem(CANARY_KEY, JSON.stringify({ count: 5, at: Date.now() - 3600 * 1000 }));
    await act(async () => { noteLibraryAtBoot(0); });
    const shown = await until(() => notice(), "the notice again");
    await act(async () => { fireEvent.click([...shown.querySelectorAll("button")].find((b) => b.textContent.trim() === "Start fresh")); });
    await until(() => !notice(), "the notice to go");
    expect(JSON.parse(localStorage.getItem(CANARY_KEY)).count).toBe(0);
    expect(screen.queryByText(/library here is empty/)).toBeNull();
  });
});
