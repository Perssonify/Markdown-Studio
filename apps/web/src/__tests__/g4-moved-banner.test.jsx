// @vitest-environment-options {"url": "https://markdowneditor.perssonify.com/"}
/**
 * A004 — the domain move strands every existing library.
 *
 * Browser storage is per-origin: documents written at
 * markdowneditor.perssonify.com are invisible at markdownstudio.com, which
 * greets the same person with an empty (first-run) library. On the OLD origin
 * the app now says so and offers the full backup in one click; importing it on
 * the new origin is the ordinary File ▸ Open path (Help ▸ Moving your library).
 * This file runs with the page at the old origin (see the first line).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useDocumentStore } from "../store/documents/documentStore";
import { _resetDurabilityForTests, noteLibraryAtBoot, recordFullBackup } from "../store/persistence/storage-durability";
import { DurabilityNotices } from "../ui/DurabilityNotices";
import { HELP_SECTIONS } from "../ui/pages/help-content";

beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    });
  }
});

beforeEach(() => {
  localStorage.clear();
  _resetDurabilityForTests();
  useDocumentStore.getState().initStorage({
    list: async () => [], get: async () => null, save: async () => {}, delete: async () => {},
    search: async () => [], getPrefs: async () => ({}), setPrefs: async () => {},
  });
  noteLibraryAtBoot(2);
  useDocumentStore.setState({ documents: [{ id: "a" }, { id: "b" }] });
});

afterEach(() => cleanup());

function renderNotices(props = {}) {
  const onBackup = vi.fn();
  render(
    <DurabilityNotices appNotices checkStorage onBackup={onBackup} onImportFiles={() => {}} onOpenVersionHistory={() => {}} {...props} />
  );
  return onBackup;
}

describe("on the old origin", () => {
  it("runs on the old origin (guards this file's premise)", () => {
    expect(window.location.hostname).toBe("markdowneditor.perssonify.com");
  });

  it("announces the move and runs the full backup in one click", async () => {
    const onBackup = renderNotices();
    const banner = await screen.findByRole("status", { name: "Markdown Studio has moved" });
    expect(banner).toHaveTextContent(/moved to markdownstudio\.com/);
    expect(banner).toHaveTextContent(/download a full backup, then import it/);
    fireEvent.click(screen.getByRole("button", { name: /Download backup/ }));
    expect(onBackup).toHaveBeenCalledTimes(1);
    const link = screen.getByRole("link", { name: /Open markdownstudio\.com/ });
    expect(link).toHaveAttribute("href", "https://markdownstudio.com");
  });

  it("after the backup, points at the next step", async () => {
    recordFullBackup();
    renderNotices();
    const banner = await screen.findByRole("status", { name: "Markdown Studio has moved" });
    expect(banner).toHaveTextContent(/You downloaded a full backup today/);
    expect(screen.getByRole("button", { name: /Download again/ })).toBeInTheDocument();
  });

  it("can be hidden for the rest of the visit", async () => {
    renderNotices();
    fireEvent.click(await screen.findByRole("button", { name: "Hide for now" }));
    await waitFor(() => expect(screen.queryByRole("status", { name: "Markdown Studio has moved" })).toBeNull());
  });

  it("is not shown inside an embed", async () => {
    renderNotices({ appNotices: false });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("on any origin", () => {
  it("Help explains how to move a library with a full backup", () => {
    const section = HELP_SECTIONS.find((s) => s.id === "moving-library");
    expect(section).toBeTruthy();
    const text = JSON.stringify(section);
    expect(text).toMatch(/Full backup \(\.zip\)/);
    expect(text).toMatch(/Open file/);
    expect(text).toMatch(/markdownstudio\.com/);
  });
});
