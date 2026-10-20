import { useEffect, useRef } from "react";
import { isLockedShare, LIVE_SHARE_KEY, liveShareOf } from "../store/documents/live-share-meta";
import { useDocumentStore } from "../store/documents/documentStore";
import { useUIStore } from "../store/preferences/uiStore";

/**
 * A shared document that is read-only here (store/documents/live-share-meta.ts)
 * opens read-only: a read-only share link, or a copy following a live share,
 * whose next update would replace anything typed into it.
 *
 * Read-only is the editor's SESSION flag (never the persisted preference),
 * switched on when such a document is opened and back to what it was when a
 * document that is not is opened — the way the newer-version lock does it
 * (useDocumentLifecycle). Only the transitions act: the user can still turn
 * read-only off from the View menu, and typing does not switch it back on.
 * The way to make the document editable for good is the notice above the
 * status bar (ui/notices/sharedDocNotice).
 *
 * Opening a live copy that has been updated also clears its "updated" mark in
 * the library.
 */
export function useSharedDocLock() {
  const forcedRef = useRef<{ prev: boolean } | null>(null);
  const lastKeyRef = useRef<string | null>(null);
  const seenRef = useRef<string | null>(null);

  useEffect(() => {
    const apply = (s: ReturnType<typeof useDocumentStore.getState>) => {
      const doc = s.activeDoc && s.hydratedDocId === s.activeDoc.id ? s.activeDoc : null;
      const locked = !!doc && isLockedShare(doc.metadata);
      const key = doc ? `${doc.id}:${locked}` : null;
      if (key !== lastKeyRef.current) {
        lastKeyRef.current = key;
        const ui = useUIStore.getState();
        if (locked) {
          if (!forcedRef.current) forcedRef.current = { prev: ui.readOnly };
          if (!ui.readOnly) useUIStore.setState({ readOnly: true });
        } else if (forcedRef.current) {
          useUIStore.setState({ readOnly: forcedRef.current.prev });
          forcedRef.current = null;
        }
      }
      const live = doc ? liveShareOf(doc.metadata) : null;
      if (doc && live?.unseen) {
        const seen = `${doc.id}:${live.revision}`;
        if (seenRef.current !== seen) {
          seenRef.current = seen;
          void s.patchDocById(doc.id, { metadata: { [LIVE_SHARE_KEY]: { ...live, unseen: false } }, touchUpdated: false }).catch(() => {});
        }
      }
    };
    apply(useDocumentStore.getState());
    return useDocumentStore.subscribe(apply);
  }, []);
}
