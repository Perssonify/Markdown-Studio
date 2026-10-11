import type { Database } from "@markdown-studio/db";
import { schema } from "@markdown-studio/db";
import { and, eq, inArray } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";
import type { Storage } from "../../../lib/storage/index.ts";

/**
 * /api/sync — each signed-in user's library in the cloud: documents, the
 * images in them, and the folder tree.
 *
 *   GET    /api/sync/state                  every document's revision (tombstones too) + the folder tree
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

const docKey = (userId: string, docId: string) => `users/${userId}/documents/${docId}.json.gz`;
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

  app.get("/api/sync/state", async (c: Ctx) => {
    const userId = c.get("userId");
    const rows = await db!
      .select({ id: D.docId, title: D.title, updated: D.updated, deleted: D.deleted, size: D.size })
      .from(D)
      .where(eq(D.userId, userId));
    const [lib] = await db!.select({ tree: L.folderTree, updated: L.updated }).from(L).where(eq(L.userId, userId));
    return c.json({ documents: rows, library: lib ?? null });
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
      if (!row) return c.json({ deleted: true });
      if (row.updated !== base) return c.json({ error: "conflict", current: { updated: row.updated, deleted: row.deleted } }, 409);
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

  return app;
}
