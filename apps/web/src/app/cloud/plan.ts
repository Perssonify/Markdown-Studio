/**
 * What one sync cycle should do, decided from three facts per document — pure,
 * so every rule is a unit test (cloud-plan.test.js):
 *
 *  - LOCAL: this browser's stored revision (`updated`), if it has the document;
 *  - SERVER: the account's revision, or a tombstone (`deleted`);
 *  - SYNCED: the revisions both sides had when they last agreed on this device.
 *
 * Against SYNCED each side either changed or did not. One side changed → it
 * goes to the other. Both changed → the NEWER change wins, and the caller keeps
 * the losing version in Version history. The rules that protect data:
 *
 *  - A document is deleted on the server ONLY because this browser deleted it
 *    (`pendingDeletes`, recorded from the editor's own delete event). A document
 *    merely MISSING here — a browser that wiped its storage, a missed event — is
 *    downloaded again, never deleted from the account.
 *  - A deletion loses to an edit made after it: the note comes back.
 */

export interface Revision {
  updated: string;
}
export interface ServerRevision {
  updated: string;
  deleted: boolean;
}
/** The local and server revisions at the last agreement. */
export interface SyncedRevision {
  local: string;
  server: string;
}

export type SyncAction =
  /** Upload the local document; `base` is the server revision it replaces (null: none). */
  | { kind: "push"; id: string; base: string | null }
  /** Download the server's document over the local one (or create it). */
  | { kind: "pull"; id: string }
  /** The account deleted it: delete it here (kept in Version history). */
  | { kind: "deleteLocal"; id: string; serverUpdated: string }
  /** This browser deleted it: delete it in the account. */
  | { kind: "deleteRemote"; id: string; base: string; at: string }
  /** Both changed. `winner` is the newer; the other version is kept in Version history. */
  | { kind: "conflict"; id: string; winner: "local" | "remote"; server: ServerRevision }
  /** Both sides already agree: just remember it. */
  | { kind: "markSynced"; id: string; revision: string }
  /** Nothing left to track for this id. */
  | { kind: "forget"; id: string };

export interface PlanInput {
  local: ReadonlyMap<string, Revision>;
  server: ReadonlyMap<string, ServerRevision>;
  synced: Readonly<Record<string, SyncedRevision>>;
  /** Documents this browser deleted, with when (ISO), not yet deleted in the account. */
  pendingDeletes: Readonly<Record<string, string>>;
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};
/** Strictly newer. A tie goes to the server, so two devices settle on the same answer. */
export const isNewer = (a: string, b: string) => time(a) > time(b);

export function planSync({ local, server, synced, pendingDeletes }: PlanInput): SyncAction[] {
  const ids = new Set([...local.keys(), ...server.keys(), ...Object.keys(synced), ...Object.keys(pendingDeletes)]);
  const actions: SyncAction[] = [];
  for (const id of [...ids].sort()) {
    const L = local.get(id);
    const S = server.get(id);
    const St = Object.prototype.hasOwnProperty.call(synced, id) ? synced[id] : undefined;
    const deletedAt = Object.prototype.hasOwnProperty.call(pendingDeletes, id) ? pendingDeletes[id] : undefined;

    if (deletedAt !== undefined) {
      if (!S || S.deleted) actions.push({ kind: "forget", id });
      else if (St && S.updated === St.server) actions.push({ kind: "deleteRemote", id, base: S.updated, at: deletedAt });
      // Changed in the account since this browser last saw it: the later of
      // that edit and this deletion wins.
      else if (isNewer(S.updated, deletedAt)) actions.push({ kind: "pull", id });
      else actions.push({ kind: "deleteRemote", id, base: S.updated, at: deletedAt });
      continue;
    }

    if (!L && (!S || S.deleted)) {
      if (St || S) actions.push({ kind: "forget", id });
      continue;
    }

    if (S && S.deleted) {
      // L exists (the case above handled !L).
      if (St && L!.updated === St.local) actions.push({ kind: "deleteLocal", id, serverUpdated: S.updated });
      else if (isNewer(L!.updated, S.updated)) actions.push({ kind: "push", id, base: S.updated });
      else actions.push({ kind: "deleteLocal", id, serverUpdated: S.updated });
      continue;
    }

    if (L && !S) {
      actions.push({ kind: "push", id, base: null });
      continue;
    }
    if (!L && S) {
      // Never "deleted because missing": bring it (back) here.
      actions.push({ kind: "pull", id });
      continue;
    }

    // Both present.
    const l = L!.updated;
    const s = S!.updated;
    if (!St) {
      if (l === s) actions.push({ kind: "markSynced", id, revision: l });
      else actions.push({ kind: "conflict", id, winner: isNewer(l, s) ? "local" : "remote", server: S! });
      continue;
    }
    const localChanged = l !== St.local;
    const remoteChanged = s !== St.server;
    if (!localChanged && !remoteChanged) continue;
    if (localChanged && !remoteChanged) actions.push({ kind: "push", id, base: s });
    else if (!localChanged && remoteChanged) actions.push({ kind: "pull", id });
    else if (l === s) actions.push({ kind: "markSynced", id, revision: l });
    else actions.push({ kind: "conflict", id, winner: isNewer(l, s) ? "local" : "remote", server: S! });
  }
  return actions;
}
