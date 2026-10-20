import { type MutableRefObject, useCallback, useEffect, useRef } from "react";
import { AUTOSAVE_MS } from "../constants";
import { stashUnsaved, type RecoveryEntry } from "../store/persistence/crash-recovery";
import type { DocumentRecord } from "../store/documents/document";
import { collectUnloadStash, describeUncommittedSave, isBlankCanonical, useDocumentStore } from "../store/documents/documentStore";
import { StorageQuotaError } from "../store/persistence/storage-adapter";
import { t } from "../i18n";
import type { PerssonifyEditorProps } from "./props";
import type { CmRef, DocStore, Lifecycle, SyncEngine, TiptapRef, Toast } from "./types";

/** What the user is told when autosave finds storage full — what happened
 *  and, more to the point, what would fix it. */
const STORAGE_FULL_MESSAGE = () => t("editor.storageFullNotSaved");

interface AutosaveParams {
  cmRef: CmRef;
  tiptapRef: TiptapRef;
  /** True once the boot sequence has put a document into the editor. Until
   *  then the editor is empty, and saving it would destroy the stored copy. */
  initDoneRef: MutableRefObject<boolean>;
  activeDoc: DocStore["activeDoc"];
  saveStatus: DocStore["saveStatus"];
  saveActiveDoc: DocStore["saveActiveDoc"];
  getCanonical: SyncEngine["getCanonical"];
  flushPendingSync: Lifecycle["flushPendingSync"];
  prepareToLeaveActiveDoc: Lifecycle["prepareToLeaveActiveDoc"];
  /** A library surface (map / Cards) is covering the editor. */
  graphVisible: boolean;
  cardsVisible: boolean;
  toast: Toast;
  onSave?: PerssonifyEditorProps["onSave"];
  onStorageQuotaExceeded?: PerssonifyEditorProps["onStorageQuotaExceeded"];
}

/**
 * Saving: the explicit ⌘S save, the idle autosave and its re-arm ladder, the
 * flush when a library surface opens, and the unload safety net (a last
 * best-effort write plus the SYNCHRONOUS crash-recovery stash).
 *
 * Returns `autosaveRef` — always the latest autosave — for paths that must
 * persist what is being edited before they read the library off disk (bulk
 * and backup export).
 */
export function useAutosave({
  cmRef, tiptapRef, initDoneRef, activeDoc, saveStatus, saveActiveDoc, getCanonical,
  flushPendingSync, prepareToLeaveActiveDoc, graphVisible, cardsVisible, toast,
  onSave, onStorageQuotaExceeded,
}: AutosaveParams) {
  // ── Save handler ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const editor = tiptapRef.current?.getEditor();
    if (!editor) return;
    // Data-integrity guard: until initialization has pushed the document into
    // the editor, the editor is empty — saving then would overwrite the stored
    // canonical with nothing. Refuse instead of destroying content.
    if (!initDoneRef.current) return;
    // Flush any still-debounced markdown→HTML sync so the source-pane typing
    // that has not been projected yet is included in the save (the UI said
    // "Saved" while silently missing those keystrokes).
    flushPendingSync();
    try {
      // Resolution is not a commit (see saveActiveDoc): a refused blank write,
      // an ownership abort and a swallowed write error all resolve. Only a
      // committed write may say "Changes saved" or tell the host it happened.
      const committed = await saveActiveDoc(editor);
      if (!committed) {
        const { message, type } = describeUncommittedSave(useDocumentStore.getState());
        toast.show(message, type);
        return;
      }
      toast.show(t("editor.changesSaved"), "success");
      if (onSave && activeDoc) {
        const markdown = cmRef.current?.getValue() || "";
        const html = tiptapRef.current?.getHTML() || "";
        const canonical = getCanonical();
        onSave({ docId: activeDoc.id, markdown, html, canonical });
      }
    } catch (e) {
      if (e instanceof StorageQuotaError) {
        if (onStorageQuotaExceeded) {
          onStorageQuotaExceeded(e);
        } else {
          toast.show(e.message, "error");
        }
      } else {
        toast.show(t("editor.saveFailed"), "error");
      }
    }
  }, [saveActiveDoc, toast, onStorageQuotaExceeded, onSave, activeDoc, getCanonical, flushPendingSync]);

  // ── Idle autosave ─────────────────────────────────────────────────────────
  // Persist the canonical PM JSON automatically after a short pause in editing.
  // Writing canonical is cheap (no markdown/HTML conversion happens here — that's
  // the sync engine's job, already debounced), so this stays responsive even for
  // large documents. Manual ⌘S / Save remains as a redundant affordance.
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorReArmRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutosaveToastRef = useRef(0);
  const autosave = useCallback(async () => {
    const editor = tiptapRef.current?.getEditor();
    if (!editor) return;
    if (!initDoneRef.current) return; // never autosave an uninitialized (empty) editor
    // Include the last ≤800ms of source-pane typing — without this flush the
    // write missed the still-debounced keystrokes while the UI said "Saved".
    flushPendingSync();
    try {
      // Autosave writes ONLY to browser storage (IndexedDB/localStorage via the
      // storage adapter). It deliberately does NOT invoke the host `onSave`
      // callback — automatic persistence stays local; sending content anywhere
      // else remains an explicit, user-initiated action (manual Save / export).
      await saveActiveDoc(editor);
      // The data-loss backstop refused to persist a blank editor over real
      // stored content (an accidental full-clear). Tell the user why it's "not
      // saving" and how to recover — otherwise it reads as a silent bug.
      if (useDocumentStore.getState().saveStatus === "blocked") {
        if (Date.now() - lastAutosaveToastRef.current > 30_000) {
          lastAutosaveToastRef.current = Date.now();
          // The same wording ⌘S uses — which also knows that a document from a
          // newer build is "blocked" without being empty.
          const { message, type } = describeUncommittedSave(useDocumentStore.getState());
          toast.show(message, type);
        }
      }
    } catch (e) {
      const isConflict = e instanceof Error && e.message.startsWith("This document was changed");
      if (e instanceof StorageQuotaError) {
        // saveActiveDoc parked the TERMINAL "full" status. Say what would help,
        // once per 30s — this used to toast the raw error on every retry, and
        // the retries never stopped. No re-arm: freeing space or typing retries.
        if (onStorageQuotaExceeded) onStorageQuotaExceeded(e);
        else if (Date.now() - lastAutosaveToastRef.current > 30_000) {
          lastAutosaveToastRef.current = Date.now();
          toast.show(STORAGE_FULL_MESSAGE(), "error");
        }
        return;
      } else {
        // Any failed autosave means the user's latest edits are NOT persisted —
        // staying silent here let edits vanish on close with zero warning.
        // Throttle the toast (failures retry every few seconds — see below).
        const msg = isConflict
          ? t("editor.conflictMessage")
          : t("editor.autosaveFailed");
        if (Date.now() - lastAutosaveToastRef.current > 30_000) {
          lastAutosaveToastRef.current = Date.now();
          toast.show(msg, "warning");
        }
      }
      if (isConflict) {
        // saveActiveDoc parked a TERMINAL "conflict" status. Do NOT route it
        // through error→editing: that would re-arm autosave, which would just
        // re-detect the same conflict every few seconds (a toast + status loop).
        // Leave it visible in the status bar; the next real edit sets "editing"
        // and saving resumes (the user has chosen to keep working in this tab).
        return;
      }
      // Re-arm: the re-arm effect only fires on saveStatus TRANSITIONS, and a
      // guard-rejected save leaves the status stuck at "editing" — autosave
      // would silently die for the rest of the session. Route through a brief
      // "error" state so error→editing re-triggers the effect (and retries).
      useDocumentStore.setState({ saveStatus: "error" });
      if (errorReArmRef.current) clearTimeout(errorReArmRef.current);
      errorReArmRef.current = setTimeout(() => {
        errorReArmRef.current = null;
        if (useDocumentStore.getState().saveStatus === "error") {
          useDocumentStore.setState({ saveStatus: "editing" });
        }
      }, 3000);
    }
  }, [saveActiveDoc, onStorageQuotaExceeded, toast, flushPendingSync]);
  const autosaveRef = useRef(autosave);
  useEffect(() => { autosaveRef.current = autosave; }, [autosave]);
  // Cleared on unmount: the store is module-scoped, so a stray re-arm firing
  // after a library host unmounts the editor would resurrect a save status for
  // an editor that no longer exists.
  useEffect(() => () => {
    if (errorReArmRef.current) clearTimeout(errorReArmRef.current);
  }, []);
  // Mirrored for the unload handler, whose effect has empty deps (it must not
  // re-subscribe on every render of the shell).
  const getCanonicalRef = useRef(getCanonical);
  useEffect(() => { getCanonicalRef.current = getCanonical; }, [getCanonical]);

  // Opening the graph snapshots reality: persist in-flight edits first so the
  // link index, node sizes and doc/link counts reflect what was just typed —
  // otherwise the graph quietly renders the last-saved state and "lies".
  // Cards is the same kind of surface and needs the same treatment: it hydrates
  // every card from the STORED records, so without this the board opens showing
  // the last-saved text of the document being edited right now.
  useEffect(() => {
    const surfaceOpen = graphVisible || cardsVisible;
    if (!surfaceOpen || !initDoneRef.current) return;
    // "editing" alone is the wrong oracle for "there is unsaved work" — the
    // beforeunload handler below uses editing|saving|error|conflict, and it is
    // right. A document whose last autosave FAILED sits in "error" for up to 3s
    // per retry cycle, and one that lost a multi-tab race parks on "conflict"
    // terminally; both have unsaved content and neither was being flushed here.
    const status = useDocumentStore.getState().saveStatus;
    if (status === "editing" || status === "saving" || status === "error") {
      void autosaveRef.current();
    }
    // "conflict" and "full" are deliberately NOT re-saved (they would only be
    // refused again), but the draft must still be cached so a leaving path has
    // something to keep. prepareToLeaveActiveDoc caches it; its own save
    // attempt is refused the same way and changes nothing.
    if (status === "conflict" || status === "full") void prepareToLeaveActiveDoc();
  }, [graphVisible, cardsVisible, prepareToLeaveActiveDoc]);

  // Re-arm a debounced save whenever the document enters the "editing" state.
  useEffect(() => {
    if (saveStatus !== "editing") return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      autosaveRef.current();
    }, AUTOSAVE_MS);
    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [saveStatus]);

  // ── Save on leaving the page ──────────────────────────────────────────────
  // Switching to another tab or window saves NOW rather than up to
  // AUTOSAVE_MS later. The same document open in two tabs was the common way
  // to hit "Changed in another tab — not saving": type in one tab, switch and
  // type in the other within the autosave window, and the first tab's pending
  // save was older than the second's. Saved on the way out, the second tab
  // reloads it before the user starts typing there; it also reaches the
  // account (and other devices) sooner.
  useEffect(() => {
    const flush = () => {
      if (!initDoneRef.current) return;
      const status = useDocumentStore.getState().saveStatus;
      if (status !== "editing" && status !== "error") return;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      void autosaveRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // ── Safety net before tab/window close ────────────────────────────────────
  // Autosave keeps the unsaved window small (≤ AUTOSAVE_MS); if a save is still
  // pending, fire one last best-effort write and warn so the last edits aren't
  // lost (IndexedDB can't be awaited during unload).
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const s = useDocumentStore.getState();
      // Unsaved work exists when: the active doc is dirty OR a save is in
      // flight OR the last save failed OR background docs hold cached drafts
      // (parked by doc switches — they live only in memory).
      const activeUnsaved = s.saveStatus === "editing" || s.saveStatus === "saving" || s.saveStatus === "error";
      // A conflict means this tab has unsaved edits it deliberately WON'T write
      // (another tab owns the newer version) — still warn on close, but do NOT
      // re-attempt the save (it would only re-refuse; never risk clobbering).
      // A full store is the same shape: unsaved, and a retry can only fail.
      const conflicted = s.saveStatus === "conflict" || s.saveStatus === "full";
      const drafts = s._unsavedEdits;
      if (!activeUnsaved && !conflicted && drafts.size === 0) return;

      // Best-effort persistence (IndexedDB can't be awaited during unload):
      // the active doc via a last autosave, and every parked draft directly.
      if (activeUnsaved) autosaveRef.current();

      // …and a SYNCHRONOUS stash, because "best-effort" measured out as "never"
      // on a reload: saveActiveDoc awaits a read before it writes, so the page
      // is gone before the write is even issued, and the in-memory draft cache
      // does not survive a reload either. Type a sentence and press ⌘R inside
      // the autosave window and it was on neither pane nor disk afterwards.
      // localStorage is the only store that completes while the page is being
      // torn down; documentStore.initialize adopts it on the next boot.
      // The editor's JSON belongs to hydratedDocId, not activeDocId — stashing
      // it under the wrong id is the cross-document overwrite every other path
      // in this file guards against.
      const owns = !!s.activeDocId && s.hydratedDocId === s.activeDocId;
      const live = owns ? getCanonicalRef.current() : null;
      // Which entries (and the revision each was written against — without it a
      // reload laundered a two-tab conflict) is decided by collectUnloadStash,
      // which also applies the blank-over-content backstop to parked drafts.
      const stash: RecoveryEntry[] = collectUnloadStash(
        s, live && !isBlankCanonical(live) ? live : null, Date.now()
      );
      for (const entry of stash) {
        if (entry.docId === s.activeDocId) continue;
        // Parked drafts are also written directly (best effort; the stash is
        // the copy that survives when this write does not land). patchDocById
        // measures drift against the draft's own base, so a draft another tab
        // has since overtaken is refused here rather than written over it.
        s.patchDocById(entry.docId, { canonical: entry.canonical as DocumentRecord["canonical"] }).catch(() => {});
      }
      stashUnsaved(stash);
      e.preventDefault();
    };
    // `pagehide` as well as `beforeunload`: iOS Safari does not fire
    // beforeunload at all when the tab is swiped away or the app is
    // backgrounded, and a bfcache eviction skips it too. The handler is
    // idempotent — the stash merges per document, the newest entry winning.
    const handlePageHide = () => handleBeforeUnload(new Event("pagehide") as BeforeUnloadEvent);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, []);

  return { handleSave, autosaveRef };
}
