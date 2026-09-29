/**
 * Normalize a user-supplied import URL into a directly-fetchable resource URL.
 *
 * Many "share" links point at a viewer/webpage, not the underlying file — a
 * Google Drive `/file/d/…/view` link returns the Drive viewer HTML, a GitHub
 * `/blob/` link returns the repo page, a Dropbox `?dl=0` link returns a preview.
 * This module rewrites those to their raw-download equivalents so the importer
 * fetches the actual document. Providers whose raw endpoint sends permissive
 * CORS headers (notably Google Drive's `drive.usercontent.google.com`) can then
 * be read by a purely client-side app.
 *
 * Anything we don't recognize is passed through unchanged, so standard direct
 * links keep working. Cases that genuinely can't work client-side (e.g. a Drive
 * *folder*, which has no no-auth download endpoint) throw a friendly, actionable
 * error instead of silently importing junk.
 */
import { UrlImportError } from "./url-import";

export type ImportUrlProvider =
  | "google-drive"
  | "google-docs"
  | "github"
  | "dropbox"
  | "generic";

export interface NormalizedImportUrl {
  /** The URL to actually fetch. */
  fetchUrl: string;
  provider: ImportUrlProvider;
  /** True when the raw endpoint may return a non-file page (best-effort export)
   *  — the fetch layer applies an extra "did we get a webpage?" guard for these. */
  bestEffort?: boolean;
  /** A short human note surfaced in the preview (e.g. "Google Doc → HTML"). */
  note?: string;
}

const GDRIVE_FILE_ID = /[-\w]{25,}/;

/** Pull a Drive file id out of the common Drive URL shapes. */
function driveFileId(u: URL): string | null {
  // /file/d/{id}/view, /d/{id}
  const m = u.pathname.match(/\/(?:file\/)?d\/([-\w]{25,})/);
  if (m) return m[1] ?? null;
  // ?id={id}  (open?id=, uc?id=, download?id=)
  const id = u.searchParams.get("id");
  if (id && GDRIVE_FILE_ID.test(id)) return id;
  return null;
}

/** Detect a Drive *folder* link — not importable client-side (needs the Drive
 *  API + auth). */
function isDriveFolder(u: URL): boolean {
  return /\/(?:drive\/)?folders\//.test(u.pathname);
}

export function normalizeImportUrl(raw: string): NormalizedImportUrl {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    // Let the downstream validator produce the canonical "invalid URL" message.
    return { fetchUrl: raw.trim(), provider: "generic" };
  }
  const host = u.hostname.toLowerCase();

  // ── Google Drive ──────────────────────────────────────────────────────────
  if (host === "drive.google.com" || host === "drive.usercontent.google.com") {
    if (isDriveFolder(u)) {
      throw new UrlImportError(
        "That's a Google Drive folder. Folders can't be imported directly (Google " +
          "provides no public download for them). In Drive, either right-click the " +
          "folder → Download (Google zips it) and import that .zip here, or share the " +
          "individual files.",
      );
    }
    const id = driveFileId(u);
    if (id) {
      return {
        fetchUrl: `https://drive.usercontent.google.com/download?id=${id}&export=download`,
        provider: "google-drive",
      };
    }
    // Unknown Drive shape — pass through and let the fetch/guard handle it.
    return { fetchUrl: u.href, provider: "google-drive", bestEffort: true };
  }

  // ── Google Docs / Sheets / Slides (native editors) ────────────────────────
  // Best-effort export to a text-ish format. These may or may not send CORS
  // headers for a given doc; on failure the dialog's paste fallback covers it.
  if (host === "docs.google.com") {
    const m = u.pathname.match(/\/(document|spreadsheets|presentation)\/d\/([-\w]{25,})/);
    if (m) {
      const kind = m[1];
      const id = m[2];
      if (kind === "document") {
        return {
          fetchUrl: `https://docs.google.com/document/d/${id}/export?format=html`,
          provider: "google-docs",
          bestEffort: true,
          note: "Google Doc → HTML export",
        };
      }
      if (kind === "spreadsheets") {
        return {
          fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`,
          provider: "google-docs",
          bestEffort: true,
          note: "Google Sheet → CSV export",
        };
      }
      // Slides have no useful text export; guide the user instead.
      throw new UrlImportError(
        "Google Slides can't be imported as a document. Use File → Download → " +
          "Markdown/HTML in Slides, then import that file or paste its content.",
      );
    }
  }

  // ── GitHub blob → raw ─────────────────────────────────────────────────────
  if (host === "github.com") {
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (m) {
      return {
        fetchUrl: `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`,
        provider: "github",
      };
    }
  }

  // ── Dropbox preview → direct download ─────────────────────────────────────
  if (host === "www.dropbox.com" || host === "dropbox.com") {
    const url = new URL(u.href);
    url.searchParams.set("dl", "1");
    return { fetchUrl: url.href, provider: "dropbox" };
  }

  // ── Everything else: use as-is ────────────────────────────────────────────
  return { fetchUrl: u.href, provider: "generic" };
}
