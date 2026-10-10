/**
 * When may the page reload ITSELF — and what counts as unsaved work.
 *
 * Three paths used to call `location.reload()` on their own authority: a new
 * service worker taking control, Vite's preload error, and the lazy-chunk error
 * boundary. None of them asked whether the user was mid-sentence or offline,
 * so a deploy force-reloaded every open tab mid-edit (undo history, an IME
 * composition and any open dialog gone, or a surprise "Leave site?"), and an
 * offline tab reloaded itself onto the browser's error page. Every self-reload
 * now goes through the decisions below. A reload the USER asks for is always
 * allowed while online — the editor's own beforeunload guard still warns about
 * unsaved work, and the unload stash still keeps it.
 */
import { useDocumentStore } from "../store/documents/documentStore";
import { recordDiagnostic } from "./diagnostics";

/** The slice of document-store state the oracle reads (never writes). */
export interface UnsavedState {
  saveStatus: string;
  _unsavedEdits?: { size: number };
}

/**
 * Is there anything a reload could lose? The same oracle as the editor's
 * beforeunload guard (editing | saving | error | conflict, or parked drafts),
 * plus "blocked": that state means the editor holds something the save path
 * refused, and a machine should not be the one to throw it away.
 */
export function hasUnsavedWork(s: UnsavedState): boolean {
  if (s.saveStatus !== "ready" && s.saveStatus !== "saved") return true;
  return (s._unsavedEdits?.size ?? 0) > 0;
}

/** Live read of the document store. Read-only by construction. */
export function unsavedNow(): boolean {
  try {
    return hasUnsavedWork(useDocumentStore.getState());
  } catch {
    return true; // cannot tell → assume there is something to lose
  }
}

export const isOnline = (): boolean => typeof navigator === "undefined" || navigator.onLine !== false;

export type ReloadDecision = "reload" | "wait";

export interface UpdateReloadContext {
  online: boolean;
  unsaved: boolean;
  /** `document.visibilityState === "hidden"` */
  hidden: boolean;
  /** The user pressed "Reload". */
  userRequested: boolean;
}

/**
 * A new version has taken control of this page. Reload it now, or wait?
 *  - Never offline: the page would come back as whatever the cache holds (or
 *    the browser's error page), not as the new version.
 *  - On the user's request: yes.
 *  - Otherwise only with nothing unsaved AND the tab in the background, where
 *    nobody is looking at it. A visible tab gets a prompt instead.
 */
export function decideUpdateReload(ctx: UpdateReloadContext): ReloadDecision {
  if (!ctx.online) return "wait";
  if (ctx.userRequested) return "reload";
  if (ctx.unsaved) return "wait";
  return ctx.hidden ? "reload" : "wait";
}

/** Shared with the pre-rework build (same key), so a loop cannot span the upgrade. */
export const CHUNK_RELOAD_KEY = "pf:preload-reload-at";
export const CHUNK_RELOAD_THROTTLE_MS = 10_000;

/**
 * A lazy chunk failed to load. In the same page nothing but a reload can fix
 * that (the browser caches the failed module), so reload automatically — but
 * only when it can help (online), cannot hurt (nothing unsaved), and is not a
 * loop (no self-reload in the last 10s). Otherwise the caller shows the error
 * and a Reload button.
 */
export function mayAutoReloadForChunk(ctx: { online: boolean; unsaved: boolean; lastReloadAt: number; now: number }): boolean {
  return ctx.online && !ctx.unsaved && ctx.now - ctx.lastReloadAt >= CHUNK_RELOAD_THROTTLE_MS;
}

/** Indirection so tests can observe a reload (jsdom's location.reload is fixed). */
export const pageActions = {
  reload: (): void => {
    window.location.reload();
  },
};

/**
 * The page is being left (a navigation, a close). Firefox rejects the old
 * page's in-flight dynamic imports as it goes — measured: 6 of 12 navigations
 * away in the first ~0.7s after load — and the resulting "chunk failed" reload
 * CANCELLED the user's navigation and reloaded the app instead. `beforeunload`
 * and `pagehide` fire first (by ~3ms), so a failure after them is the
 * navigation's doing, never a reason to reload.
 */
let leavingAt = 0;

/** A page still alive this long after `beforeunload` was not left after all
 *  (a cancelled "Leave site?" prompt); chunk failures may reload again. */
const LEAVING_WINDOW_MS = 10_000;

/** Call once at startup (the app shell). Idempotent. */
export function trackPageLeaving(): void {
  if (typeof window === "undefined" || (trackPageLeaving as { done?: boolean }).done) return;
  (trackPageLeaving as { done?: boolean }).done = true;
  const leaving = () => { leavingAt = Date.now(); };
  window.addEventListener("beforeunload", leaving);
  window.addEventListener("pagehide", leaving);
  // Restored from the back/forward cache: the page is live again.
  window.addEventListener("pageshow", () => { leavingAt = 0; });
}

/** Whether the page is being left (see trackPageLeaving). */
export function isPageLeaving(now: number = Date.now()): boolean {
  return leavingAt > 0 && now - leavingAt < LEAVING_WINDOW_MS;
}

/** Test hook. */
export function _setPageLeavingForTests(at: number): void {
  leavingAt = at;
}

/** Reload for a chunk failure if (and only if) the policy allows it. */
export function reloadForChunkErrorIfSafe(): boolean {
  if (isPageLeaving()) return false; // the user is navigating away: let them
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
  } catch {
    /* sessionStorage unavailable — treat as "never reloaded" */
  }
  const now = Date.now();
  if (!mayAutoReloadForChunk({ online: isOnline(), unsaved: unsavedNow(), lastReloadAt: last, now })) return false;
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Without the stamp a reload could loop; better to show the error instead.
    return false;
  }
  pageActions.reload();
  return true;
}

/**
 * Record failed, refused and conflicted saves in the diagnostics ring. A
 * subscription only — it reads the store and changes nothing. Returns the
 * unsubscribe function.
 */
export function watchSaveProblems(): () => void {
  return useDocumentStore.subscribe((s, prev) => {
    if (s.saveStatus === prev.saveStatus) return;
    if (s.saveStatus === "error" || s.saveStatus === "blocked" || s.saveStatus === "conflict") {
      recordDiagnostic({ kind: "save", name: `save-${s.saveStatus}`, message: s.saveError ?? "" });
    }
  });
}
