/**
 * "Block remote images" (Settings ▸ Privacy) — production-readiness audit A076.
 *
 * An image in a document is fetched from wherever it is hosted the moment the
 * document opens, which tells that host the reader's IP address and when they
 * looked: the classic tracking pixel, arriving inside an imported or pasted
 * note. With the setting on, the page only loads images from its own origin
 * plus inline `data:` / `blob:` URLs.
 *
 * Enforced as a Content-Security-Policy `img-src` delivered by a <meta> element,
 * which the browser applies to every image requested after it is inserted —
 * the rich pane, the Cards previews and the map alike — without touching a
 * single document or converter. Two consequences, both deliberate:
 *  - It must be installed before any document renders, so the standalone app
 *    shell installs it at startup (App.tsx). The npm library never calls it:
 *    a library must not restrict its host page (see CLAUDE.md "The library must
 *    not touch the host page").
 *  - A policy delivered this way cannot be relaxed by removing the element, so
 *    switching the setting OFF (or on) takes effect on the next load.
 *
 * Blocked images show as their alt text / a broken-image glyph; nothing in the
 * document changes.
 */
import { safeStorage } from "./safe-storage";

export const BLOCK_REMOTE_IMAGES_KEY = "pf:block-remote-images";
export const REMOTE_IMAGE_CSP = "img-src 'self' data: blob:";
const MARKER = "data-pf-remote-images";

let installedHere = false;

export function remoteImagesBlocked(): boolean {
  return safeStorage.get(BLOCK_REMOTE_IMAGES_KEY) === "true";
}

export function setRemoteImagesBlocked(value: boolean): void {
  safeStorage.set(BLOCK_REMOTE_IMAGES_KEY, String(value));
}

/**
 * Install the policy in `doc` when the setting is on. Also records that this
 * page CAN enforce it, so Settings only offers the switch where it works.
 * Returns whether a policy is in force. Never throws.
 */
export function installRemoteImagePolicy(doc: Document | undefined = typeof document !== "undefined" ? document : undefined): boolean {
  installedHere = true;
  if (!doc || !remoteImagesBlocked()) return false;
  try {
    if (doc.head.querySelector(`meta[${MARKER}]`)) return true;
    const meta = doc.createElement("meta");
    meta.httpEquiv = "Content-Security-Policy";
    meta.content = REMOTE_IMAGE_CSP;
    meta.setAttribute(MARKER, "");
    doc.head.appendChild(meta);
    return true;
  } catch {
    return false;
  }
}

/** Whether this page enforces the setting (the standalone app does; a library host does not). */
export function remoteImagePolicySupported(): boolean {
  return installedHere;
}

/** Is a policy actually in force on this page right now? */
export function remoteImagePolicyActive(doc: Document | undefined = typeof document !== "undefined" ? document : undefined): boolean {
  try {
    return !!doc?.head.querySelector(`meta[${MARKER}]`);
  } catch {
    return false;
  }
}

export function _resetRemoteImagesForTests(): void {
  installedHere = false;
}
