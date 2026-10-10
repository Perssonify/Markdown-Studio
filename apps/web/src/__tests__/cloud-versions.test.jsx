/**
 * Version history ▸ In your account: the account's earlier versions of the open
 * note (the bucket keeps each replaced version 30 days). Bringing one back
 * stores it as an "account-version" snapshot and restores THAT, so it is undone
 * the way any restore is (the current text is snapshotted first).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { accountVersionsProvider } from "../app/cloud/versions";
import { getAccountVersions, setAccountVersions } from "../store/history/account-versions";
import { snapshotStore } from "../store/history/snapshot-store";
import { useDocumentStore } from "../store/documents/documentStore";
import { useUIStore } from "../store/preferences/uiStore";
import { DialogProvider } from "../ui/dialogs/dialogProvider";
import { VersionHistorySheet } from "../ui/history/versionHistorySheet";
import { en } from "../i18n/en";

const para = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const record = (id, text) => ({ id, title: text, userTitle: null, titlePinnedByUser: false, canonical: para(text) });
const HOUR = 3_600_000;

beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
      dispatchEvent() { return false; },
    });
  }
});

let unregister = () => {};
beforeEach(() => {
  snapshotStore._resetForTests();
  useUIStore.setState({ readOnly: false });
  useDocumentStore.setState({ documents: [] });
});
afterEach(() => {
  unregister();
  cleanup();
  vi.restoreAllMocks();
});

function fakeArchive(versions = { n1: [{ id: "v3", at: Date.now(), size: 10, latest: true }, { id: "v2", at: Date.now() - 2 * HOUR, size: 9, latest: false }, { id: "v1", at: Date.now() - 30 * HOUR, size: 8, latest: false }] }) {
  const texts = { v1: "first draft", v2: "second draft", v3: "now" };
  return {
    listVersions: vi.fn(async (docId) => versions[docId] ?? []),
    getVersion: vi.fn(async (docId, id) => (texts[id] && versions[docId] ? record(docId, texts[id]) : null)),
  };
}

describe("the account's versions, for Version history", () => {
  it("lists a note's earlier versions, leaving out the one synced now", async () => {
    const p = accountVersionsProvider(fakeArchive(), snapshotStore);
    expect((await p.list("n1")).map((v) => v.id)).toEqual(["v2", "v1"]);
    expect(await p.list("n2")).toEqual([]);
  });

  it("asks nothing for a note sync does not carry", async () => {
    const api = fakeArchive();
    expect(await accountVersionsProvider(api, snapshotStore).list("../x")).toEqual([]);
    expect(api.listVersions).not.toHaveBeenCalled();
  });

  it("brings one back as an account-version snapshot holding exactly that text", async () => {
    const p = accountVersionsProvider(fakeArchive(), snapshotStore);
    const id = await p.bringBack("n1", "v1");
    const [meta] = await snapshotStore.listForDoc("n1");
    expect(meta).toMatchObject({ id, reason: "account-version", title: "first draft" });
    expect(await snapshotStore.getCanonical(id)).toEqual(para("first draft"));
  });

  it("brings back nothing the account no longer has, or that is another note's", async () => {
    const api = fakeArchive();
    api.getVersion.mockResolvedValueOnce(record("other", "x"));
    const p = accountVersionsProvider(api, snapshotStore);
    expect(await p.bringBack("n1", "v1")).toBeNull();
    expect(await p.bringBack("n1", "gone")).toBeNull();
    expect(await snapshotStore.listForDoc("n1")).toEqual([]);
  });

  it("is registered while the app syncs, and removed after", () => {
    const p = accountVersionsProvider(fakeArchive(), snapshotStore);
    const off = setAccountVersions(p);
    expect(getAccountVersions()).toBe(p);
    off();
    expect(getAccountVersions()).toBeNull();
  });
});

function renderSheet({ activeDocId = "n1" } = {}) {
  const props = { onRestoreInPlace: vi.fn(async () => {}), onRestoreAsNew: vi.fn(async () => {}), onOpenChange: vi.fn() };
  render(
    <DialogProvider value={{ confirm: async () => true, prompt: async () => null, equation: async () => null, confirmUnsaved: async () => "cancel" }}>
      <VersionHistorySheet open activeDocId={activeDocId} {...props} />
    </DialogProvider>,
  );
  return props;
}

describe("Version history ▸ In your account", () => {
  it("is not there without an account (the embed, the library, a signed-out visitor)", async () => {
    renderSheet();
    await screen.findByText(en["dialogs.thisDocument"]);
    expect(screen.queryByText(en["dialogs.inYourAccount"])).toBeNull();
  });

  it("lists the open note's earlier versions", async () => {
    unregister = setAccountVersions(accountVersionsProvider(fakeArchive(), snapshotStore));
    renderSheet();
    expect(await screen.findByText(en["dialogs.inYourAccount"])).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText(en["dialogs.accountVersion"])).toHaveLength(2));
  });

  it("restores one in place, through a snapshot of exactly that version", async () => {
    unregister = setAccountVersions(accountVersionsProvider(fakeArchive(), snapshotStore));
    const props = renderSheet();
    await waitFor(() => expect(screen.getAllByText(en["dialogs.accountVersion"])).toHaveLength(2));
    const row = screen.getAllByText(en["dialogs.accountVersion"])[1].closest("li");
    await act(async () => fireEvent.click(row.querySelector("button")));
    await waitFor(() => expect(props.onRestoreInPlace).toHaveBeenCalledTimes(1));
    const id = props.onRestoreInPlace.mock.calls[0][0];
    expect(await snapshotStore.getCanonical(id)).toEqual(para("first draft"));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("restores one as a new document", async () => {
    unregister = setAccountVersions(accountVersionsProvider(fakeArchive(), snapshotStore));
    const props = renderSheet();
    await waitFor(() => expect(screen.getAllByText(en["dialogs.accountVersion"])).toHaveLength(2));
    const row = screen.getAllByText(en["dialogs.accountVersion"])[0].closest("li");
    await act(async () => fireEvent.click(row.querySelectorAll("button")[1]));
    await waitFor(() => expect(props.onRestoreAsNew).toHaveBeenCalledTimes(1));
    expect(props.onRestoreAsNew.mock.calls[0][0]).toMatchObject({ docId: "n1", reason: "account-version", title: "second draft" });
  });

  it("says so when a version cannot be brought back, and restores nothing", async () => {
    const api = fakeArchive();
    api.getVersion.mockResolvedValue(null);
    unregister = setAccountVersions(accountVersionsProvider(api, snapshotStore));
    const props = renderSheet();
    await waitFor(() => expect(screen.getAllByText(en["dialogs.accountVersion"])).toHaveLength(2));
    await act(async () => fireEvent.click(screen.getAllByText(en["dialogs.accountVersion"])[0].closest("li").querySelector("button")));
    expect(await screen.findByText(en["dialogs.accountVersionCouldNotBeBroughtBack"])).toBeTruthy();
    expect(props.onRestoreInPlace).not.toHaveBeenCalled();
  });

  it("says so when the account cannot be reached", async () => {
    const api = fakeArchive();
    api.listVersions.mockRejectedValue(new Error("offline"));
    unregister = setAccountVersions(accountVersionsProvider(api, snapshotStore));
    renderSheet();
    expect(await screen.findByText(en["dialogs.accountVersionsUnavailable"])).toBeTruthy();
  });

  it("restores nothing in read-only mode", async () => {
    useUIStore.setState({ readOnly: true });
    unregister = setAccountVersions(accountVersionsProvider(fakeArchive(), snapshotStore));
    renderSheet();
    await waitFor(() => expect(screen.getAllByText(en["dialogs.accountVersion"])).toHaveLength(2));
    for (const b of screen.getAllByText(en["dialogs.accountVersion"])[0].closest("li").querySelectorAll("button")) expect(b.disabled).toBe(true);
  });
});
