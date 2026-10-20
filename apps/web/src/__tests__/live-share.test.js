// Live shares and read-only shares on the device side (PL-51): the flags a
// shared document carries (store/documents/live-share-meta.ts), the copy a
// live share publishes (store/documents/live-share.ts), and a follower's copy
// being kept up to date (app/publish refreshFollowed) — against a real
// (fake-indexeddb) library and a stubbed server.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshFollowed } from "../app/publish";
import { createDocument, toSummary } from "../store/documents/document";
import { buildLiveDocument, isLockedShare, LIVE_SHARE_KEY, liveShareOf, ownCopyPatch, READ_ONLY_SHARE_KEY } from "../store/documents/live-share";
import { snapshotStore } from "../store/history/snapshot-store";
import { decodeSharePayload, encodeSharePayload } from "../store/importExport/share-link";
import { IndexedDBStorageAdapter } from "../store/persistence/idb-storage-adapter";

const para = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const textOf = (rec) => rec?.canonical?.content?.[0]?.content?.[0]?.text;
const PUB = "AbCdEfGhIjKlMnOpQrStUv"; // 22 characters, like the server's ids

describe("a shared document's flags", () => {
  it("read-only shares and followed live copies open read-only; an ended one does not", () => {
    expect(isLockedShare({})).toBe(false);
    expect(isLockedShare({ [READ_ONLY_SHARE_KEY]: true })).toBe(true);
    expect(isLockedShare({ [LIVE_SHARE_KEY]: { id: PUB, revision: "r1" } })).toBe(true);
    expect(isLockedShare({ [LIVE_SHARE_KEY]: { id: PUB, revision: "r1", ended: true } })).toBe(false);
    // A field block that happens to use the name is not a live share.
    expect(liveShareOf({ [LIVE_SHARE_KEY]: "yes" })).toBeNull();
    expect(isLockedShare({ [READ_ONLY_SHARE_KEY]: "true" })).toBe(false);
  });

  it("'make it my own' clears both", () => {
    const after = { [LIVE_SHARE_KEY]: { id: PUB, revision: "r1" }, [READ_ONLY_SHARE_KEY]: true, cardColor: "blue", ...ownCopyPatch() };
    expect(isLockedShare(after)).toBe(false);
    expect(after.cardColor).toBe("blue");
  });

  it("reach the library's summary only when present", () => {
    const plain = toSummary(createDocument({ id: "p", canonical: para("x") }));
    expect("liveShare" in plain).toBe(false);
    expect("readOnlyShare" in plain).toBe(false);
    const live = toSummary(createDocument({ id: "l", canonical: para("x"), metadata: { [LIVE_SHARE_KEY]: { id: PUB, revision: "r1", unseen: true } } }));
    expect(live.liveShare).toEqual({ id: PUB, unseen: true, ended: false });
    expect(toSummary(createDocument({ id: "r", canonical: para("x"), metadata: { [READ_ONLY_SHARE_KEY]: true } })).readOnlyShare).toBe(true);
  });
});

describe("share links carry how they open", () => {
  it("a layout and read-only survive the link; anything else does not", () => {
    const enc = encodeSharePayload({ v: 1, kind: "file", name: "n", docs: [{ path: [], title: "t", markdown: "x", metadata: { evil: true } }], view: "md", readOnly: true });
    const dec = decodeSharePayload(enc);
    expect(dec).toMatchObject({ view: "md", readOnly: true });
    // Metadata is the app's to set (a live share), never a link's.
    expect(dec.docs[0].metadata).toBeUndefined();
    expect(decodeSharePayload(encodeSharePayload({ v: 1, kind: "file", name: "n", docs: [{ path: [], title: "t", markdown: "x" }], view: "nope" })).view).toBeUndefined();
  });
});

describe("the copy a live share publishes", () => {
  it("is the document and its images — not the owner's id, metadata or import history", async () => {
    const hash = "a".repeat(64);
    const canonical = { type: "doc", content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Plan" }] }, { type: "image", attrs: { src: `pf-asset:${hash}` } }] };
    const rec = { ...createDocument({ id: "owner-doc", canonical, metadata: { cardColor: "red", secret: 1 } }), updated: "2026-10-19T10:00:00.000Z" };
    const live = await buildLiveDocument(rec, async (h) => (h === hash ? { mime: "image/png", bytes: new Uint8Array([1, 2, 3]) } : null));
    expect(live.revision).toBe("2026-10-19T10:00:00.000Z");
    expect(live.title).toBe("Plan");
    expect(live.document._format).toBe("perssonify-document");
    expect(live.document.canonical).toEqual(canonical);
    expect(live.document.id).toBeUndefined();
    expect(live.document.metadata).toEqual({});
    expect(live.document.origin).toBeUndefined();
    expect(live.document.ingestReport).toBeUndefined();
    expect(Object.keys(live.document.assets)).toEqual([hash]);
  });
});

describe("following a live share", () => {
  let storage;
  let replies;
  const reply = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const publication = (revision, text) => ({
    v: 1, id: PUB, title: "Handbook", revision,
    document: { _format: "perssonify-document", title: "Handbook", canonical: para(text) },
  });

  beforeEach(async () => {
    snapshotStore._resetForTests?.();
    storage = new IndexedDBStorageAdapter({ dbName: `live-follow-${Math.random()}`, snapshots: false });
    const doc = createDocument({ id: "copy", title: "Handbook", canonical: para("v1"), metadata: { [LIVE_SHARE_KEY]: { id: PUB, revision: "2026-10-19T10:00:00.000Z" } } });
    await storage.save({ ...doc, updated: "2026-10-19T10:00:00.000Z", _preserveUpdated: true });
    replies = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const next = replies.shift();
      if (!next) throw new Error(`unexpected request ${url}`);
      next.urls?.push(String(url));
      return next.res();
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks with the revision it has, and changes nothing while the owner has not", async () => {
    const urls = [];
    replies.push({ urls, res: () => reply(200, { unchanged: true, revision: "2026-10-19T10:00:00.000Z" }) });
    expect(await refreshFollowed(storage)).toBe(0);
    expect(urls[0]).toBe(`/api/published/${PUB}?since=${encodeURIComponent("2026-10-19T10:00:00.000Z")}`);
    expect(textOf(await storage.get("copy"))).toBe("v1");
  });

  it("takes the owner's new version, marks it updated, and keeps the old one in Version history", async () => {
    replies.push({ res: () => reply(200, publication("2026-10-19T11:00:00.000Z", "v2 from the owner")) });
    expect(await refreshFollowed(storage)).toBe(1);
    const rec = await storage.get("copy");
    expect(textOf(rec)).toBe("v2 from the owner");
    // The owner's revision, so every device following it writes the same one.
    expect(rec.updated).toBe("2026-10-19T11:00:00.000Z");
    expect(liveShareOf(rec.metadata)).toMatchObject({ id: PUB, revision: "2026-10-19T11:00:00.000Z", unseen: true, ended: false });
    expect((await storage.list()).find((s) => s.id === "copy").liveShare).toEqual({ id: PUB, unseen: true, ended: false });
    const versions = await snapshotStore.listForDoc("copy");
    expect(versions.some((v) => v.reason === "live-update")).toBe(true);
  });

  // An OUTCOME check: what someone else sent never reaches the library with a
  // dangerous link. Two layers give that — applyPublication sanitises what it
  // is sent, and every read from storage sanitises again (createDocument) — so
  // removing either one alone does not turn this red; removing both does.
  it("never keeps a dangerous link it is sent", async () => {
    const hostile = publication("2026-10-19T12:00:00.000Z", "x");
    hostile.document.canonical = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] };
    replies.push({ res: () => reply(200, hostile) });
    await refreshFollowed(storage);
    expect(JSON.stringify((await storage.get("copy")).canonical)).not.toContain("javascript:");
  });

  it("when the owner stops sharing, it stops following and becomes the user's own", async () => {
    replies.push({ res: () => reply(404, { error: "not_published" }) });
    expect(await refreshFollowed(storage)).toBe(1);
    const rec = await storage.get("copy");
    expect(textOf(rec)).toBe("v1");
    expect(liveShareOf(rec.metadata)).toMatchObject({ ended: true });
    expect(isLockedShare(rec.metadata)).toBe(false);
    // An ended copy is not asked about again.
    expect(await refreshFollowed(storage)).toBe(0);
  });

  it("a 404 that is not the share's own answer (a deploy, a proxy) does not end it", async () => {
    replies.push({ res: () => new Response("<html>Not Found</html>", { status: 404 }) });
    replies.push({ res: () => reply(404, { error: "not_found" }) });
    expect(await refreshFollowed(storage)).toBe(0);
    expect(await refreshFollowed(storage)).toBe(0);
    expect(liveShareOf((await storage.get("copy")).metadata)).toMatchObject({ ended: false });
  });

  it("leaves the note alone when the user stopped following it while the update was on its way", async () => {
    replies.push({
      res: async () => {
        // "Stop following" (a real revision) lands while the server answers.
        const rec = await storage.get("copy");
        await storage.save({ ...rec, metadata: { ...rec.metadata, ...ownCopyPatch() }, updated: "2026-10-19T10:30:00.000Z", _preserveUpdated: true });
        return reply(200, publication("2026-10-19T11:00:00.000Z", "v2 from the owner"));
      },
    });
    expect(await refreshFollowed(storage)).toBe(0);
    const rec = await storage.get("copy");
    expect(textOf(rec)).toBe("v1");
    expect(liveShareOf(rec.metadata)).toBeNull();
  });

  it("a failure (offline) changes nothing and is tried again next time", async () => {
    replies.push({ res: () => { throw new TypeError("Failed to fetch"); } });
    expect(await refreshFollowed(storage)).toBe(0);
    expect(liveShareOf((await storage.get("copy")).metadata)).toMatchObject({ revision: "2026-10-19T10:00:00.000Z", ended: false });
  });
});
