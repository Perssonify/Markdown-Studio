import type { Database } from "@markdown-studio/db";
import { schema } from "@markdown-studio/db";
import { and, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import type { Storage } from "../../../lib/storage/index.ts";

/**
 * /api/sync — each signed-in user's library in the cloud: documents, the
 * images in them, and the folder tree.
 *
 *   GET    /api/sync/state?since=           every document's revision (tombstones too) + the folder tree,
 *                                           and its `version` — or { unchanged } when that is still `since`
 *   GET    /api/sync/documents/:id          one document (gzip JSON)
 *   PUT    /api/sync/documents/:id          store one   { base, record }   (gzip JSON body)
 *   DELETE /api/sync/documents/:id?base=&at= delete one (kept as a tombstone)
 *   PUT    /api/sync/library                the folder tree { base, tree } → { updated } (a revision the server issues)
 *   POST   /api/sync/assets/upload          presigned uploads for images the account lacks
 *   POST   /api/sync/assets/commit          record uploaded images (after S3 verified them)
 *   POST   /api/sync/assets/download        presigned downloads
 *   GET    /api/sync/documents/:id/versions             the versions the bucket keeps (30 days), thinned
 *   GET    /api/sync/documents/:id/versions/:versionId  one past version (gzip JSON)
 *   POST   /api/sync/backups/upload         a presigned upload for one day's backup ZIP
 *   GET    /api/sync/backups                the backups kept
 *   GET    /api/sync/backups/:date          a presigned download of one
 *   PUT    /api/sync/published/:docId       publish (or update) a document's live share { revision, title, document } → { id }
 *   DELETE /api/sync/published/:docId       stop publishing it
 *   GET    /api/published/:id?since=        a live share, for anyone with its link (publishedRoutes below)
 *
 * Every write is CONDITIONAL: the client says which server revision its change
 * is based on (`base`), and a row lock makes the check and the write one step.
 * A mismatch is a 409 carrying the current revision — the client then decides
 * (the newest change wins; the other is kept in its Version history). Content
 * lives in S3 under users/<userId>/, the index in Postgres; the bucket is
 * versioned, so an overwritten or deleted document stays recoverable 30 days.
 */

export interface SyncDeps {
  db: Database | null;
  storage: Storage | null;
  /** The signed-in user's id, or null. */
  userIdOf: ((c: Context) => Promise<string | null>) | null;
}

/** Document ids as the editor makes them (`generateId`) — and safe as one S3 key segment. */
export const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const HASH = /^[0-9a-f]{64}$/;
/** What the editor stores as an image (asset-refs.ts `isRasterMime`). */
const RASTER = /^image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)$/i;
export const MAX_DOCUMENT_BYTES = 64 * 1024 * 1024;
export const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_BATCH = 200;
/** Requests that change something must carry this header: a cross-site page cannot set it without CORS letting it. */
export const SYNC_HEADER = "x-requested-with";
export const SYNC_HEADER_VALUE = "markdown-studio";

const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO date");
const PutDocument = z.object({
  base: iso.nullable(),
  record: z
    .object({ id: z.string(), updated: iso, title: z.string().optional(), canonical: z.object({ type: z.literal("doc") }).passthrough() })
    .passthrough(),
});
const PutLibrary = z.object({
  /** The revision this tree is based on — opaque, issued by the server (null: none yet). */
  base: z.string().max(100).nullable(),
  tree: z.object({ folders: z.array(z.unknown()), docParents: z.record(z.string(), z.string()), docOrder: z.record(z.string(), z.array(z.string())) }),
});
const AssetList = z.object({
  assets: z.array(z.object({ hash: z.string().regex(HASH), mime: z.string().regex(RASTER), size: z.number().int().positive().max(MAX_ASSET_BYTES) })).max(MAX_BATCH),
});
const HashList = z.object({ hashes: z.array(z.string().regex(HASH)).max(MAX_BATCH) });
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const VERSION_ID = /^[A-Za-z0-9._-]{1,1024}$/;
export const MAX_BACKUP_BYTES = 1024 * 1024 * 1024;
/** Backups are tagged, so a bucket lifecycle rule can expire old ones (infra FilesStack). */
export const BACKUP_TAGGING = "kind=backup";
const BackupUpload = z.object({
  date: z.string().regex(DATE),
  size: z.number().int().positive().max(MAX_BACKUP_BYTES),
  sha256: z.string().regex(HASH),
  /** Replace that day's backup (the "Back up now" button). */
  force: z.boolean().optional(),
});

/** A live share's public id: 128 random bits, base64url (`newPublishedId`). */
export const PUBLISHED_ID = /^[A-Za-z0-9_-]{22}$/;
/** A published copy carries its images inline, so it may be larger than a synced note's record. */
export const MAX_PUBLISHED_BYTES = 32 * 1024 * 1024;
const PutPublished = z.object({
  /** The document revision (`updated`) this copy was made from. */
  revision: iso,
  title: z.string().max(500),
  /** The document as the editor exports it (the `perssonify-document` envelope). */
  document: z
    .object({ _format: z.literal("perssonify-document"), canonical: z.object({ type: z.literal("doc") }).passthrough() })
    .passthrough(),
  /**
   * UPDATE ONLY: the live share's public id, which must still be this
   * document's. The sync engine republishes with it, so a republish racing
   * "Stop sharing live" cannot bring the share back under a new id. Absent
   * (the Share dialog): publish, creating the share if there is none.
   */
  id: z.string().regex(/^[A-Za-z0-9_-]{22}$/).optional(),
});
const newPublishedId = () => randomBytes(16).toString("base64url");

/** At most this many versions are listed for one note. */
export const MAX_LISTED_VERSIONS = 50;
const MIN_VERSION_GAP_MS = 5 * 60_000;

/**
 * The versions worth listing. A note synced while it is typed gets a version
 * per save, so the newest 50 would all be from the last few minutes. This
 * keeps the newest, then each older one only when it is far enough from the
 * last one kept — at least 5 minutes, and a fifth of its age (an hour-old
 * version stands 12 minutes from its neighbour, a week-old one a day or so) —
 * so the list reaches back across the whole 30 days.
 */
export function thinVersions<T extends { lastModified: number }>(newestFirst: T[], now = Date.now()): T[] {
  const kept: T[] = [];
  for (const v of newestFirst) {
    const prev = kept[kept.length - 1];
    if (prev && prev.lastModified - v.lastModified < Math.max(MIN_VERSION_GAP_MS, (now - v.lastModified) / 5)) continue;
    kept.push(v);
    if (kept.length === MAX_LISTED_VERSIONS) break;
  }
  return kept;
}

/**
 * What `GET /api/sync/state` describes, as one short string: every document's
 * revision and tombstone, and the folder tree's revision — exactly what a
 * device plans its sync from. Equal versions mean the same plan, so a device
 * that sends back the version it holds (`?since=`) is told "unchanged" instead
 * of being sent the whole list again. Order-independent (sorted by id).
 */
export function stateVersion(
  docs: { id: string; updated: string; deleted: boolean }[],
  libraryUpdated: string | null,
  published: { docId: string; id: string; revision: string }[] = [],
): string {
  const h = createHash("sha256");
  const byKey = <T>(key: (x: T) => string) => (a: T, b: T) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
  for (const d of [...docs].sort(byKey((x) => x.id))) {
    h.update(`${d.id}\u0000${d.updated}\u0000${d.deleted ? 1 : 0}\n`);
  }
  h.update(`library\u0000${libraryUpdated ?? ""}\n`);
  for (const p of [...published].sort(byKey((x) => x.docId))) {
    h.update(`published\u0000${p.docId}\u0000${p.id}\u0000${p.revision}\n`);
  }
  return h.digest("base64url").slice(0, 32);
}

const docKey = (userId: string, docId: string) => `users/${userId}/documents/${docId}.json.gz`;
const publishedKey = (userId: string, docId: string) => `users/${userId}/published/${docId}.json.gz`;
const assetKey = (userId: string, hash: string) => `users/${userId}/assets/${hash}`;
const backupPrefix = (userId: string) => `users/${userId}/backups/`;
const backupKey = (userId: string, date: string) => `${backupPrefix(userId)}${date}.zip`;
const gzipJson = (body: Uint8Array) =>
  new Response(body, { status: 200, headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "no-store" } });
const hexToBase64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");

type Ctx = Context<{ Variables: { userId: string } }>;
type Upload = { hash: string; url: string; headers: Record<string, string> };

type SyncEnv = { Variables: { userId: string } };

export function syncRoutes({ db, storage, userIdOf }: SyncDeps): Hono<SyncEnv> {
  const app = new Hono<SyncEnv>();

  app.use("/api/sync/*", async (c, next) => {
    if (!db || !storage || !userIdOf) return c.json({ error: "sync_not_configured" }, 503);
    if (c.req.method !== "GET" && c.req.header(SYNC_HEADER) !== SYNC_HEADER_VALUE) {
      return c.json({ error: "forbidden" }, 403);
    }
    const userId = await userIdOf(c);
    if (!userId) return c.json({ error: "unauthorized" }, 401);
    c.set("userId", userId);
    c.header("Cache-Control", "no-store");
    await next();
  });

  const D = schema.syncDocument;
  const A = schema.syncAsset;
  const L = schema.syncLibrary;
  const P = schema.publishedDocument;
  type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
  /** Stop publishing a document (if it is): its row and its public copy. */
  const unpublish = async (tx: Tx, userId: string, docId: string) => {
    const [row] = await tx.select({ id: P.id }).from(P).where(and(eq(P.userId, userId), eq(P.docId, docId))).for("update");
    if (!row) return;
    await tx.delete(P).where(eq(P.id, row.id));
    await storage!.remove(publishedKey(userId, docId));
  };

  app.get("/api/sync/state", async (c: Ctx) => {
    const userId = c.get("userId");
    const rows = await db!
      .select({ id: D.docId, title: D.title, updated: D.updated, deleted: D.deleted, size: D.size })
      .from(D)
      .where(eq(D.userId, userId));
    const [lib] = await db!.select({ tree: L.folderTree, updated: L.updated }).from(L).where(eq(L.userId, userId));
    // The documents this user publishes, and which revision each live copy
    // holds: a device that has a newer one updates it (the sync engine).
    const published = await db!.select({ docId: P.docId, id: P.id, revision: P.revision }).from(P).where(eq(P.userId, userId));
    // A device polls this every few seconds while it is in use. When nothing
    // changed since the state it last read (`?since=` the version it was
    // given), the answer is just that — not the whole manifest again.
    const version = stateVersion(rows, lib?.updated ?? null, published);
    if (c.req.query("since") === version) return c.json({ unchanged: true, version });
    return c.json({ documents: rows, library: lib ?? null, published, version });
  });

  app.get("/api/sync/documents/:id", async (c: Ctx) => {
    const userId = c.get("userId");
    const id = c.req.param("id") ?? "";
    if (!DOC_ID.test(id)) return c.json({ error: "bad_id" }, 400);
    const [row] = await db!.select().from(D).where(and(eq(D.userId, userId), eq(D.docId, id)));
    if (!row || row.deleted) return c.json({ error: "not_found" }, 404);
    const obj = await storage!.get(docKey(userId, id));
    if (!obj) return c.json({ error: "not_found" }, 404);
    return new Response(obj.body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "no-store", "X-Doc-Updated": row.updated },
    });
  });

  app.put("/api/sync/documents/:id", async (c: Ctx) => {
    const userId = c.get("userId");
    const id = c.req.param("id") ?? "";
    if (!DOC_ID.test(id)) return c.json({ error: "bad_id" }, 400);
    let text: string;
    try {
      const raw = Buffer.from(await c.req.arrayBuffer());
      text = (c.req.header("content-encoding") === "gzip" ? gunzipSync(raw, { maxOutputLength: MAX_DOCUMENT_BYTES }) : raw).toString("utf8");
    } catch {
      return c.json({ error: "bad_body" }, 400);
    }
    let parsed: z.infer<typeof PutDocument>;
    try {
      parsed = PutDocument.parse(JSON.parse(text));
    } catch {
      return c.json({ error: "bad_document" }, 400);
    }
    const { base, record } = parsed;
    if (record.id !== id) return c.json({ error: "id_mismatch" }, 400);
    const body = gzipSync(Buffer.from(JSON.stringify(record), "utf8"));

    return db!.transaction(async (tx) => {
      const [row] = await tx.select().from(D).where(and(eq(D.userId, userId), eq(D.docId, id))).for("update");
      const current = row ? row.updated : null;
      if (current !== base) return c.json({ error: "conflict", current: row ? { updated: row.updated, deleted: row.deleted } : null }, 409);
      await storage!.put(docKey(userId, id), body, { contentType: "application/json", contentEncoding: "gzip" });
      const values = { title: (record.title ?? "").slice(0, 500), updated: record.updated, deleted: false, size: body.length, modifiedAt: new Date() };
      await tx
        .insert(D)
        .values({ userId, docId: id, ...values })
        .onConflictDoUpdate({ target: [D.userId, D.docId], set: values });
      return c.json({ updated: record.updated });
    });
  });

  app.delete("/api/sync/documents/:id", async (c: Ctx) => {
    const userId = c.get("userId");
    const id = c.req.param("id") ?? "";
    const base = c.req.query("base") ?? null;
    const at = c.req.query("at") ?? "";
    if (!DOC_ID.test(id) || Number.isNaN(Date.parse(at))) return c.json({ error: "bad_request" }, 400);
    return db!.transaction(async (tx) => {
      const [row] = await tx.select().from(D).where(and(eq(D.userId, userId), eq(D.docId, id))).for("update");
      if (row && row.updated !== base) return c.json({ error: "conflict", current: { updated: row.updated, deleted: row.deleted } }, 409);
      // A deleted note is no longer shared live: its public copy goes with it,
      // here, in the deletion itself — not left to a device that may be
      // offline, or closed, by the time it would have asked.
      await unpublish(tx, userId, id);
      if (!row) return c.json({ deleted: true });
      // The bucket is versioned: the content stays recoverable for 30 days.
      await storage!.remove(docKey(userId, id));
      await tx.update(D).set({ deleted: true, updated: at, size: 0, modifiedAt: new Date() }).where(and(eq(D.userId, userId), eq(D.docId, id)));
      return c.json({ deleted: true, updated: at });
    });
  });

  app.put("/api/sync/library", async (c: Ctx) => {
    const userId = c.get("userId");
    let parsed: z.infer<typeof PutLibrary>;
    try {
      parsed = PutLibrary.parse(await c.req.json());
    } catch {
      return c.json({ error: "bad_library" }, 400);
    }
    return db!.transaction(async (tx) => {
      const [row] = await tx.select().from(L).where(eq(L.userId, userId)).for("update");
      if ((row ? row.updated : null) !== parsed.base) {
        return c.json({ error: "conflict", current: row ? { tree: row.folderTree, updated: row.updated } : null }, 409);
      }
      // The server issues the revision: unique even when two devices write
      // in the same millisecond, so a stale tree can never pass the check.
      const values = { folderTree: parsed.tree, updated: randomUUID(), modifiedAt: new Date() };
      await tx.insert(L).values({ userId, ...values }).onConflictDoUpdate({ target: L.userId, set: values });
      return c.json({ updated: values.updated });
    });
  });

  app.post("/api/sync/assets/upload", async (c: Ctx) => {
    const userId = c.get("userId");
    let parsed: z.infer<typeof AssetList>;
    try {
      parsed = AssetList.parse(await c.req.json());
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const hashes = [...new Set(parsed.assets.map((a) => a.hash))];
    const have = hashes.length
      ? new Set((await db!.select({ hash: A.hash }).from(A).where(and(eq(A.userId, userId), inArray(A.hash, hashes)))).map((r) => r.hash))
      : new Set<string>();
    const uploads: Upload[] = [];
    for (const a of parsed.assets) {
      if (have.has(a.hash)) continue;
      have.add(a.hash);
      const up = await storage!.presignPut(assetKey(userId, a.hash), { contentType: a.mime, sha256: hexToBase64(a.hash) });
      uploads.push({ hash: a.hash, ...up });
    }
    return c.json({ uploads, present: hashes.filter((h) => !uploads.some((u) => u.hash === h)) });
  });

  app.post("/api/sync/assets/commit", async (c: Ctx) => {
    const userId = c.get("userId");
    let parsed: z.infer<typeof HashList>;
    try {
      parsed = HashList.parse(await c.req.json());
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const committed: string[] = [];
    const missing: string[] = [];
    for (const hash of new Set(parsed.hashes)) {
      const head = await storage!.head(assetKey(userId, hash));
      // S3 verified the bytes against this checksum on upload; an object
      // without it did not come through our presigned URL.
      if (!head || head.sha256 !== hexToBase64(hash) || head.size > MAX_ASSET_BYTES || !RASTER.test(head.contentType ?? "")) {
        missing.push(hash);
        continue;
      }
      await db!.insert(A).values({ userId, hash, mime: head.contentType!, size: head.size }).onConflictDoNothing();
      committed.push(hash);
    }
    return c.json({ committed, missing });
  });

  app.post("/api/sync/assets/download", async (c: Ctx) => {
    const userId = c.get("userId");
    let parsed: z.infer<typeof HashList>;
    try {
      parsed = HashList.parse(await c.req.json());
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const hashes = [...new Set(parsed.hashes)];
    const rows = hashes.length ? await db!.select().from(A).where(and(eq(A.userId, userId), inArray(A.hash, hashes))) : [];
    const downloads = [];
    for (const r of rows) downloads.push({ hash: r.hash, mime: r.mime, url: await storage!.presignGet(assetKey(userId, r.hash)) });
    return c.json({ downloads, missing: hashes.filter((h) => !rows.some((r) => r.hash === h)) });
  });

  // ── Versions ──────────────────────────────────────────────────────────────
  // The bucket is versioned: every upload of a note keeps the one it replaced
  // for 30 days, and a deletion keeps the last content. These read them back.

  app.get("/api/sync/documents/:id/versions", async (c: Ctx) => {
    const userId = c.get("userId");
    const id = c.req.param("id") ?? "";
    if (!DOC_ID.test(id)) return c.json({ error: "bad_id" }, 400);
    const versions = thinVersions(await storage!.listVersions(docKey(userId, id)));
    return c.json({ versions: versions.map((v) => ({ id: v.versionId, at: v.lastModified, size: v.size, latest: v.isLatest })) });
  });

  app.get("/api/sync/documents/:id/versions/:versionId", async (c: Ctx) => {
    const userId = c.get("userId");
    const id = c.req.param("id") ?? "";
    const versionId = c.req.param("versionId") ?? "";
    if (!DOC_ID.test(id) || !VERSION_ID.test(versionId)) return c.json({ error: "bad_request" }, 400);
    let obj;
    try {
      obj = await storage!.get(docKey(userId, id), versionId);
    } catch {
      obj = null; // an unknown version id
    }
    if (!obj) return c.json({ error: "not_found" }, 404);
    return gzipJson(obj.body);
  });

  // ── Backups ───────────────────────────────────────────────────────────────
  // One full-backup ZIP per day (the same archive File ▸ Export ▸ Full backup
  // makes, which Import restores), uploaded by the browser straight to S3.

  app.post("/api/sync/backups/upload", async (c: Ctx) => {
    const userId = c.get("userId");
    let parsed: z.infer<typeof BackupUpload>;
    try {
      parsed = BackupUpload.parse(await c.req.json());
    } catch {
      return c.json({ error: "bad_request" }, 400);
    }
    const key = backupKey(userId, parsed.date);
    if (!parsed.force && (await storage!.head(key))) return c.json({ exists: true });
    const upload = await storage!.presignPut(key, { contentType: "application/zip", sha256: hexToBase64(parsed.sha256), tagging: BACKUP_TAGGING });
    return c.json({ exists: false, upload });
  });

  app.get("/api/sync/backups", async (c: Ctx) => {
    const userId = c.get("userId");
    const prefix = backupPrefix(userId);
    const backups = (await storage!.list(prefix))
      .map((o) => ({ date: o.key.slice(prefix.length).replace(/\.zip$/, ""), size: o.size, at: o.lastModified }))
      .filter((b) => DATE.test(b.date))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return c.json({ backups });
  });

  app.get("/api/sync/backups/:date", async (c: Ctx) => {
    const userId = c.get("userId");
    const date = c.req.param("date") ?? "";
    if (!DATE.test(date)) return c.json({ error: "bad_request" }, 400);
    const key = backupKey(userId, date);
    if (!(await storage!.head(key))) return c.json({ error: "not_found" }, 404);
    return c.json({ url: await storage!.presignGet(key, { filename: `markdown-studio-backup-${date}.zip` }) });
  });

  // ── Publishing (live shares) ──────────────────────────────────────────────
  // The owner's device uploads a read-only copy of one document — the editor's
  // own export envelope, images inline — and gets back the public id its link
  // carries. Every device of the owner keeps it current: `state` lists what is
  // published and from which revision, and a device holding a newer one
  // publishes again. Followers read it through publishedRoutes, below.

  app.put("/api/sync/published/:docId", async (c: Ctx) => {
    const userId = c.get("userId");
    const docId = c.req.param("docId") ?? "";
    if (!DOC_ID.test(docId)) return c.json({ error: "bad_id" }, 400);
    let parsed: z.infer<typeof PutPublished>;
    try {
      const raw = Buffer.from(await c.req.arrayBuffer());
      const text = (c.req.header("content-encoding") === "gzip" ? gunzipSync(raw, { maxOutputLength: MAX_PUBLISHED_BYTES }) : raw).toString("utf8");
      if (Buffer.byteLength(text) > MAX_PUBLISHED_BYTES) return c.json({ error: "too_large" }, 413);
      parsed = PutPublished.parse(JSON.parse(text));
    } catch {
      return c.json({ error: "bad_document" }, 400);
    }
    const title = parsed.title.slice(0, 500);
    return db!.transaction(async (tx) => {
      let id: string;
      if (parsed.id) {
        // Update only: the share must still exist, under that id.
        const [row] = await tx.select({ id: P.id }).from(P).where(and(eq(P.userId, userId), eq(P.docId, docId))).for("update");
        if (!row || row.id !== parsed.id) return c.json({ error: "not_published" }, 409);
        id = row.id;
      } else {
        // Create or keep: one statement, so two first publishes at once agree
        // on one id (the second waits on the first's row) instead of the loser
        // hitting the unique index.
        const [row] = await tx
          .insert(P)
          .values({ id: newPublishedId(), userId, docId, title, revision: parsed.revision })
          .onConflictDoUpdate({ target: [P.userId, P.docId], set: { modifiedAt: new Date() } })
          .returning({ id: P.id });
        id = row!.id;
      }
      const body = gzipSync(Buffer.from(JSON.stringify({ v: 1, id, title, revision: parsed.revision, document: parsed.document }), "utf8"));
      await storage!.put(publishedKey(userId, docId), body, { contentType: "application/json", contentEncoding: "gzip" });
      await tx.update(P).set({ title, revision: parsed.revision, size: body.length, modifiedAt: new Date() }).where(eq(P.id, id));
      return c.json({ id, revision: parsed.revision });
    });
  });

  app.delete("/api/sync/published/:docId", async (c: Ctx) => {
    const userId = c.get("userId");
    const docId = c.req.param("docId") ?? "";
    if (!DOC_ID.test(docId)) return c.json({ error: "bad_id" }, 400);
    return db!.transaction(async (tx) => {
      await unpublish(tx, userId, docId);
      return c.json({ deleted: true });
    });
  });

  return app;
}

/**
 * GET /api/published/:id — a live share, for anyone holding its link (no
 * sign-in: the link IS the permission, and its id is 128 random bits). A
 * follower polls with `?since=` the revision it has, and while the owner has
 * not changed the document the answer is a few bytes. Unpublished: 404, and
 * the follower keeps its last copy as its own.
 */
export function publishedRoutes({ db, storage }: Pick<SyncDeps, "db" | "storage">): Hono {
  const app = new Hono();
  app.get("/api/published/:id", async (c) => {
    c.header("Cache-Control", "no-store");
    if (!db || !storage) return c.json({ error: "not_configured" }, 503);
    // `not_published` — not the app's generic `not_found` — is what tells a
    // follower the owner stopped sharing it, so a 404 from anything else (a
    // route missing mid-deploy) is not mistaken for that.
    const id = c.req.param("id") ?? "";
    if (!PUBLISHED_ID.test(id)) return c.json({ error: "not_published" }, 404);
    const P = schema.publishedDocument;
    const [row] = await db.select({ userId: P.userId, docId: P.docId, revision: P.revision }).from(P).where(eq(P.id, id));
    if (!row) return c.json({ error: "not_published" }, 404);
    if (c.req.query("since") === row.revision) return c.json({ unchanged: true, revision: row.revision });
    const obj = await storage.get(publishedKey(row.userId, row.docId));
    if (!obj) return c.json({ error: "not_published" }, 404);
    return new Response(obj.body, {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "no-store", "X-Revision": row.revision },
    });
  });
  return app;
}
