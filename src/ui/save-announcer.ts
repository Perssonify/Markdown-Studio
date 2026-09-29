import type { SaveStatus } from "../store/documentStore";

/**
 * What the status bar's live region should SAY, as opposed to what it shows.
 *
 * A096. The visible save indicator walks editing → saving → saved on every
 * autosave, and it used to be the live region itself — so a screen reader
 * announced "Unsaved changes", "Saving…", "Changes saved" several times a
 * minute while the user typed (measured: nine announcements in twelve seconds),
 * interrupting whatever they were listening to. The routine cycle is not news.
 * Two things are:
 *
 *  - saving STARTS failing (or fails in a new way — a conflict or a blocked
 *    blank write is a different problem from a failed write), and
 *  - saving RECOVERS: the first save that lands after a failure.
 *
 * "Failing" is a condition, not a status. A failed autosave is routed
 * error → editing (with `saveError` still set) → saving → error … on every
 * retry, so keying on the status would re-announce the same failure every few
 * seconds for as long as it lasted — the noise this exists to remove, in the
 * one situation where the user most needs to be able to think.
 */

export type FailureKind = "error" | "blocked" | "conflict";

export interface SaveSnapshot {
  status: SaveStatus;
  /** The documentStore's `saveError`: set while a failed save is retrying. */
  error: string | null;
}

export interface AnnouncerState {
  /** The failure currently in progress, if any. */
  kind: FailureKind | null;
  /** A failure happened and no save has landed since. A conflict is resolved
   *  by typing (→ editing) long before a save lands, so this outlives `kind`. */
  awaitingRecovery: boolean;
}

export const INITIAL_ANNOUNCER: AnnouncerState = { kind: null, awaitingRecovery: false };

/**
 * The failure this snapshot is in, or null when saving is healthy.
 *
 * Only the three terminal-ish statuses NAME a failure. `saveError` survives the
 * statuses in between (a conflict or a blocked write keeps its error through
 * the next edit's "editing" and "saving"), so a snapshot that only carries the
 * error is a CONTINUATION of whatever failure is already in progress — reading
 * it as a fresh "error" made every edit after a conflict announce twice.
 */
export function failureKind(s: SaveSnapshot, current: FailureKind | null = null): FailureKind | null {
  if (s.status === "blocked" || s.status === "conflict" || s.status === "error") return s.status;
  if (s.error) return current ?? "error";
  return null;
}

export const FAILURE_MESSAGES: Record<FailureKind, string> = {
  error: "Save failed. Retrying; your work is still on screen.",
  blocked: "Not saving: the editor is empty but the stored document is not.",
  conflict: "Not saving: this document was changed in another tab.",
};

export const RECOVERED_MESSAGE = "Changes saved.";

/** Advance the announcer by one observed snapshot. `message` is null for
 *  "say nothing" — which is the answer for the whole routine save cycle. */
export function nextAnnouncement(
  state: AnnouncerState,
  snap: SaveSnapshot,
): { state: AnnouncerState; message: string | null } {
  const now = failureKind(snap, state.kind);
  if (now) {
    if (now === state.kind) return { state, message: null };
    return { state: { kind: now, awaitingRecovery: true }, message: FAILURE_MESSAGES[now] };
  }
  // Recovery is announced once a save has actually LANDED — not on the
  // retry's "saving", which is still a failure until it succeeds.
  if (state.awaitingRecovery && snap.status === "saved") {
    return { state: INITIAL_ANNOUNCER, message: RECOVERED_MESSAGE };
  }
  return { state: state.kind ? { kind: null, awaitingRecovery: state.awaitingRecovery } : state, message: null };
}
