/**
 * Shared documents that are read-only here — kept in the document's metadata
 * so they travel with it (cloud sync, backups):
 *
 *  - `readOnlyShare: true` — opened from a share link its sender made
 *    read-only. It opens read-only until the user chooses to edit it.
 *  - `liveShare` — a copy FOLLOWING a live share (app/publish): its owner's
 *    edits replace it when they publish, so it is read-only while followed.
 *    `ended` once the owner stopped sharing it: then it is the user's own copy.
 *
 * Read-only is the editor's session flag while such a document is open
 * (editor/useSharedDocLock.ts) — the stored document is never locked against
 * the user, who can always make it their own (ui/notices/sharedDocNotice).
 */
export const LIVE_SHARE_KEY = "liveShare";
export const READ_ONLY_SHARE_KEY = "readOnlyShare";

export interface LiveShareInfo {
  /** The live share's public id — the `#live=` of its link. */
  id: string;
  /** The owner's revision this copy holds. */
  revision: string;
  /** Updated since it was last opened here (the library marks it). */
  unseen?: boolean;
  /** The owner stopped sharing it: no more updates, and it is editable. */
  ended?: boolean;
  /** When the copy here last changed to a new revision (ISO). */
  at?: string;
}

type Metadata = Record<string, unknown> | undefined | null;

export function liveShareOf(metadata: Metadata): LiveShareInfo | null {
  const v = metadata?.[LIVE_SHARE_KEY];
  if (!v || typeof v !== "object") return null;
  const l = v as Partial<LiveShareInfo>;
  if (typeof l.id !== "string" || typeof l.revision !== "string") return null;
  return { id: l.id, revision: l.revision, unseen: l.unseen === true, ended: l.ended === true, at: typeof l.at === "string" ? l.at : undefined };
}

export const isReadOnlyShare = (metadata: Metadata): boolean => metadata?.[READ_ONLY_SHARE_KEY] === true;

/** Opens read-only: a read-only share, or a live copy still being followed. */
export function isLockedShare(metadata: Metadata): boolean {
  if (isReadOnlyShare(metadata)) return true;
  const live = liveShareOf(metadata);
  return !!live && !live.ended;
}

/** The metadata patch that makes a shared document the user's own (editable, no longer followed). */
export const ownCopyPatch = (): Record<string, unknown> => ({ [LIVE_SHARE_KEY]: null, [READ_ONLY_SHARE_KEY]: null });
