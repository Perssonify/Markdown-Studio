/**
 * Self-contained share links (no server, no account).
 *
 * A document — or a whole folder of documents — is packed into the URL itself:
 * `https://…/#share=<deflate+base64url(JSON)>`. The recipient opens the link and
 * the app unpacks it straight into their library. Nothing is uploaded anywhere;
 * the content travels INSIDE the link, in the hash fragment (which browsers never
 * send to a server), so this stays as private and offline-friendly as the rest of
 * the app.
 *
 * Trade-off: the whole document rides in the URL, so very large documents make an
 * unwieldy link. The caller warns past {@link SHARE_URL_SOFT_LIMIT}; it still
 * produces the link (some channels accept long URLs), it just can't promise every
 * chat app / server will carry it intact.
 *
 * Consumed at boot by `App.tsx` → `useEditorBoot`, which imports the docs through
 * the same `importItems` path as a file/archive import (so folder structure and
 * conversion are handled identically).
 */
import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";
import type { IngestFormat } from "./ingest";

/** One shared document: its markdown, title, and folder path (empty for a file). */
export interface ShareDoc {
  /** Folder path segments this doc sits under (`[]` = root). */
  path: string[];
  title: string;
  markdown: string;
  /** Ingest format of `markdown`. Defaults to "markdown" when absent. */
  format?: IngestFormat;
  /** Merged into the imported document's metadata. Never read from a link
   *  (decodeSharePayload drops it): only the app sets it, for a live share. */
  metadata?: Record<string, unknown>;
}

/** The layout a share opens in: the app's MD / HTML (rich) / Split modes. */
export type ShareView = "md" | "html" | "split";

export interface SharePayload {
  /** Envelope version, so an older client can refuse a newer shape cleanly. */
  v: 1;
  /** "file" = a single document; "folder" = a subtree. Purely informational. */
  kind: "file" | "folder";
  /** A human label for the share (doc title or folder name) — used in notices. */
  name: string;
  docs: ShareDoc[];
  /** The layout the recipient opens it in (this visit only). Absent: their own. */
  view?: ShareView;
  /** The recipient's copies open read-only (store/documents/live-share-meta.ts),
   *  until they make them editable. Older builds ignore both — the link still
   *  opens, as an editable copy in the recipient's own layout. */
  readOnly?: boolean;
}

export const isShareView = (v: unknown): v is ShareView => v === "md" || v === "html" || v === "split";

/** The fragment that marks a share link: `…/#share=<data>`. */
export const SHARE_HASH_KEY = "share";

/** Above this many characters the link is likely to be truncated by some
 *  channels (chat apps, mail, servers). The caller still produces it, but warns. */
export const SHARE_URL_SOFT_LIMIT = 50_000;

// ── base64url for raw bytes (btoa works on Latin-1 binary strings) ────────────
function bytesToB64Url(u8: Uint8Array): string {
  let s = "";
  // Chunked to avoid a huge spread blowing the call stack on big payloads.
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(b64: string): Uint8Array {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

/** Pack a payload into the opaque string that rides after `#share=`. */
export function encodeSharePayload(payload: SharePayload): string {
  return bytesToB64Url(deflateSync(strToU8(JSON.stringify(payload))));
}

/** Unpack a `#share=` value back into a payload, or null if it is malformed. */
export function decodeSharePayload(encoded: string): SharePayload | null {
  try {
    const obj = JSON.parse(strFromU8(inflateSync(b64UrlToBytes(encoded)))) as unknown;
    if (!obj || typeof obj !== "object") return null;
    const p = obj as Partial<SharePayload>;
    if (p.v !== 1 || !Array.isArray(p.docs)) return null;
    const docs: ShareDoc[] = [];
    for (const d of p.docs) {
      if (!d || typeof d !== "object") return null;
      const doc = d as Partial<ShareDoc>;
      if (typeof doc.markdown !== "string") return null;
      docs.push({
        path: Array.isArray(doc.path) ? doc.path.filter((s) => typeof s === "string") : [],
        title: typeof doc.title === "string" ? doc.title : "",
        markdown: doc.markdown,
        format: doc.format,
      });
    }
    if (docs.length === 0) return null;
    return {
      v: 1,
      kind: p.kind === "folder" ? "folder" : "file",
      name: typeof p.name === "string" ? p.name : "",
      docs,
      ...(isShareView(p.view) ? { view: p.view } : {}),
      ...(p.readOnly === true ? { readOnly: true } : {}),
    };
  } catch {
    return null;
  }
}

/** Build the full shareable URL for a payload. `base` defaults to the app root
 *  (origin + pathname), so the link opens the editor, never the current page. */
export function buildShareUrl(payload: SharePayload, base?: string): string {
  const root =
    base ??
    (typeof window !== "undefined"
      ? window.location.origin + window.location.pathname
      : "");
  return `${root}#${SHARE_HASH_KEY}=${encodeSharePayload(payload)}`;
}

/** Read a share payload out of a URL hash (defaults to the live location hash).
 *  Returns null when there is no `#share=` or it does not decode. */
export function readSharePayloadFromHash(hash?: string): SharePayload | null {
  const h = (hash ?? (typeof window !== "undefined" ? window.location.hash : "")).replace(/^#/, "");
  if (!h) return null;
  // The hash can carry several params; find ours.
  const params = new URLSearchParams(h);
  const value = params.get(SHARE_HASH_KEY);
  if (!value) return null;
  return decodeSharePayload(value);
}
