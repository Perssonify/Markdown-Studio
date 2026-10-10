import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DOMAIN, APP_HOSTS, LEGACY_APP_HOST } from "../constants";
import { EMBED_APP_HOST_DB, embedStorageConfig } from "../integration/embed-origins";

/**
 * A072 — the iframe embed's documents, per origin.
 *
 * On the APP's own hosts the embed shared `perssonify-docs` with the app, so a
 * page that framed the embed there could reach the app's whole library through
 * the bridge (which reads and overwrites every document the embed sees). There
 * it now has a database of its own, and its version history and crash stash
 * follow that name. On any other host — a self-hosted embed — it keeps the name
 * its users' documents are already in: renaming it would open every existing
 * embed on an empty library.
 */

const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

/** The ids of the documents stored in one raw IndexedDB database. */
async function storedIds(name) {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (!db.objectStoreNames.contains("documents")) { db.close(); return []; }
  const keys = await new Promise((resolve) => {
    const r = db.transaction("documents", "readonly").objectStore("documents").getAllKeys();
    r.onsuccess = () => resolve(r.result);
  });
  db.close();
  return keys;
}

async function snapshotDatabases() {
  return (await indexedDB.databases()).map((d) => d.name).filter((n) => n.startsWith("perssonify-snapshots"));
}

async function fresh() {
  vi.resetModules();
  return {
    ds: await import("../store/documents/documentStore"),
    snaps: (await import("../store/history/snapshot-store")).snapshotStore,
    rec: await import("../store/persistence/crash-recovery"),
    document: await import("../store/documents/document"),
  };
}

let warn;
beforeEach(() => { warn = vi.spyOn(console, "warn").mockImplementation(() => {}); localStorage.clear(); });
afterEach(() => { warn.mockRestore(); });

describe("which database the embed uses, per host", () => {
  it.each([
    "markdownstudio.com",
    "www.markdownstudio.com",
    "markdownstudio.perssonify.com",
    "markdowneditor.perssonify.com",
    "localhost",
    "127.0.0.1",
  ])("on the app's own host %s: a database of its own", (host) => {
    expect(embedStorageConfig(host)).toEqual({ dbName: "perssonify-embed-docs" });
  });

  it("the host comparison folds case and a trailing dot, and nothing else", () => {
    expect(embedStorageConfig("MarkdownStudio.COM")).toEqual({ dbName: EMBED_APP_HOST_DB });
    expect(embedStorageConfig("markdownstudio.com.")).toEqual({ dbName: EMBED_APP_HOST_DB });
    for (const lookalike of ["markdownstudio.com.example.org", "evilmarkdownstudio.com", "preview.markdownstudio.com", "localhost.example.org"]) {
      expect(embedStorageConfig(lookalike), lookalike).toBeUndefined();
    }
  });

  it.each(["editor.acme.io", "docs.example.com", "192.168.1.20", ""])(
    "on any other host (%s — a self-hosted embed): the default database, unchanged",
    (host) => {
      expect(embedStorageConfig(host)).toBeUndefined();
    });

  it("the list is the app's hosts, kept beside APP_URL", () => {
    expect(APP_HOSTS).toContain(APP_DOMAIN);
    expect(APP_HOSTS).toContain(`www.${APP_DOMAIN}`);
    expect(APP_HOSTS).toContain(LEGACY_APP_HOST);
    expect(EMBED_APP_HOST_DB).not.toBe("perssonify-docs");
  });

  it("embed.tsx hands that choice to the editor, for the host it is loaded from", () => {
    const src = readFileSync(join(process.cwd(), "src", "embed.tsx"), "utf8");
    expect(src).toMatch(/const embedStorage = embedStorageConfig\(window\.location\.hostname\);/);
    expect(src).toMatch(/<PerssonifyEditorIntegration[\s\S]*?storageConfig=\{embedStorage\}/);
  });
});

describe("the embed's database on an app host keeps everything apart from the app's", () => {
  it("documents, version history and the crash stash all follow the embed's name", async () => {
    const m = await fresh();
    m.ds.useDocumentStore.getState().initStorage(embedStorageConfig("markdownstudio.com"));
    await m.ds.useDocumentStore.getState().getStorage()
      .save(m.document.createDocument({ id: "embed-doc", title: "Embed doc", canonical: doc("embed words") }));
    await m.snaps.record("embed-doc", "Embed doc", doc("an older version"), "manual");
    m.rec.stashUnsaved([{ docId: "embed-doc", canonical: doc("an unsaved draft"), at: Date.now() }]);

    expect(await storedIds("perssonify-embed-docs")).toEqual(["embed-doc"]);
    expect(await storedIds("perssonify-docs")).not.toContain("embed-doc");
    expect(await snapshotDatabases()).toContain("perssonify-snapshots:perssonify-embed-docs");
    expect(await snapshotDatabases()).not.toContain("perssonify-snapshots");
    expect(localStorage.getItem("pf:recovery:perssonify-embed-docs")).toContain("an unsaved draft");
    expect(localStorage.getItem("pf:recovery")).toBeNull();
  });

  it("a self-hosted embed (no config) still uses the default database", async () => {
    const m = await fresh();
    const config = embedStorageConfig("editor.acme.io");
    expect(config).toBeUndefined();
    // The editor calls initStorage only when there IS a config; without one
    // the store keeps its default adapter.
    await m.ds.useDocumentStore.getState().getStorage()
      .save(m.document.createDocument({ id: "self-hosted-doc", title: "Self-hosted", canonical: doc("words") }));
    expect(await storedIds("perssonify-docs")).toContain("self-hosted-doc");
    expect(await storedIds("perssonify-embed-docs")).not.toContain("self-hosted-doc");
  });
});
