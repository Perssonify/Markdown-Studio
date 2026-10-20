import type { LiveDocument } from "@/store/documents/live-share";
import { CloudError, gzip } from "../cloud/api";

/**
 * The account server's side of live shares (apps/api modules/sync/routes:
 * `PUT|DELETE /api/sync/published/:docId` for the owner, `GET
 * /api/published/:id` for anyone with the link).
 */

/** What a live share's link reads: the document, and the owner's revision of it. */
export interface Publication {
  v: 1;
  id: string;
  title: string;
  revision: string;
  /** A `perssonify-document` envelope (store/documents/live-share.ts). */
  document: Record<string, unknown>;
}

export type PublicationReply =
  | { kind: "publication"; publication: Publication }
  /** The follower already has this revision (`since`). */
  | { kind: "unchanged" }
  /** Not (or no longer) published. */
  | { kind: "gone" };

/**
 * The most a publish request may carry. The app runs as a Vercel Function,
 * which refuses a request body over 4.5 MB — and a live copy carries its
 * images inside. Refused here, with a message, rather than by the platform.
 */
export const MAX_PUBLISH_BODY = 4 * 1024 * 1024;

const WRITE_HEADERS = { "X-Requested-With": "markdown-studio" };

/** A request gives up after this long: opening a live link waits on one. */
const REQUEST_TIMEOUT_MS = 15_000;

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  try {
    return await fetch(url, { credentials: "same-origin", cache: "no-store", signal, ...init });
  } catch (e) {
    throw new CloudError(e instanceof Error ? e.message : "network error", 0, true);
  }
}

export class PublishTooLargeError extends Error {
  constructor() {
    super("too large to publish");
    this.name = "PublishTooLargeError";
  }
}

/**
 * Publish a document's live share, creating it if there is none, and return
 * its public id. With `id` it is an UPDATE of that share only (the sync
 * engine's republish): one stopped meanwhile is refused (409), not revived.
 */
export async function publishDocument(docId: string, live: LiveDocument, id?: string): Promise<{ id: string; revision: string }> {
  const { body, encoded } = await gzip(JSON.stringify(id ? { ...live, id } : live));
  const size = typeof body === "string" ? new Blob([body]).size : (body as ArrayBuffer).byteLength;
  if (size > MAX_PUBLISH_BODY) throw new PublishTooLargeError();
  const res = await call(`/api/sync/published/${encodeURIComponent(docId)}`, {
    method: "PUT",
    headers: { ...WRITE_HEADERS, "Content-Type": "application/json", ...(encoded ? { "Content-Encoding": "gzip" } : {}) },
    body,
  });
  if (res.status === 413) throw new PublishTooLargeError();
  if (!res.ok) throw new CloudError(`publish failed (${res.status})`, res.status);
  return (await res.json()) as { id: string; revision: string };
}

/** Stop publishing it. */
export async function unpublishDocument(docId: string): Promise<void> {
  const res = await call(`/api/sync/published/${encodeURIComponent(docId)}`, { method: "DELETE", headers: WRITE_HEADERS });
  if (!res.ok) throw new CloudError(`unpublish failed (${res.status})`, res.status);
}

const PUBLISHED_ID = /^[A-Za-z0-9_-]{22}$/;
export const isPublishedId = (id: unknown): id is string => typeof id === "string" && PUBLISHED_ID.test(id);

/** Read a live share — as anyone with its link, signed in or not. */
export async function readPublication(id: string, since?: string | null): Promise<PublicationReply> {
  if (!isPublishedId(id)) return { kind: "gone" };
  const res = await call(`/api/published/${encodeURIComponent(id)}${since ? `?since=${encodeURIComponent(since)}` : ""}`, { credentials: "omit" });
  if (res.status === 404) {
    // Only the route's own answer means the owner stopped sharing it. Any
    // other 404 (a deploy without the route, a proxy) is an error to retry —
    // ending every follower's copy on it would be permanent.
    const err = ((await res.json().catch(() => null)) as { error?: unknown } | null)?.error;
    if (err === "not_published") return { kind: "gone" };
    throw new CloudError("live share not found (unexpected)", 404);
  }
  if (!res.ok) throw new CloudError(`live share failed (${res.status})`, res.status);
  const body = (await res.json()) as Partial<Publication> & { unchanged?: boolean };
  if (body.unchanged) return { kind: "unchanged" };
  if (
    body.v !== 1 || typeof body.revision !== "string" || !body.document || typeof body.document !== "object" ||
    (body.document as { _format?: unknown })._format !== "perssonify-document"
  ) {
    throw new CloudError("the live share is malformed", 502);
  }
  return { kind: "publication", publication: { v: 1, id, title: typeof body.title === "string" ? body.title : "", revision: body.revision, document: body.document } };
}
