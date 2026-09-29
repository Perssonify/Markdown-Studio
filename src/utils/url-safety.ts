const CONTROL_AND_SPACE = /[\u0000-\u0020]+/g;

export function normalizedUrlScheme(value: string): string {
  return value.replace(CONTROL_AND_SPACE, "").toLowerCase();
}

/** Raster image data-URI subtypes that are safe to inline. SVG is deliberately
 *  excluded because it can carry scripts (`<svg onload>`, `<script>`). */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon)[;,]/;

/**
 * Classify a link href for click handling. "External" links (http/https/mailto/
 * tel, or protocol-relative) are safe to open in a new tab; anything else
 * (custom scheme like `app:` / `perssonify:`, or a relative path) is treated as
 * a deep link for the host to resolve.
 */
export function isExternalHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith("//")) return true;
  const scheme = (href.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] ?? "").toLowerCase();
  return scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel";
}

export function isDangerousUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = normalizedUrlScheme(value);
  if (normalized.startsWith("javascript:")) return true;
  if (normalized.startsWith("vbscript:")) return true;
  // Allow only raster image data URIs; block data:image/svg+xml and everything
  // else (data:text/html, data:application/*, …).
  if (normalized.startsWith("data:") && !SAFE_DATA_IMAGE.test(normalized)) return true;
  return false;
}
