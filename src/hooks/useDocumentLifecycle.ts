import { Editor } from "@tiptap/core";
import { RefObject, useCallback, useEffect, useRef } from "react";
import { nextSyncCost, nextSyncWait } from "./sync-schedule";
import { cleanPasteHtml, sanitizePastedHtml } from "../engine/html-cleaner";
import { historyCache } from "../store/history-cache";
import type { IngestFormat, IngestSource } from "../store/ingest";
import { collectUnloadStash, useDocumentStore } from "../store/documentStore";
import { stashUnsaved } from "../store/crash-recovery";
import { useUIStore } from "../store/uiStore";
import { createDocument } from "../store/document";
import { snapshotStore, type SnapshotMeta } from "../store/snapshot-store";
import { canonicalMisfit, coerceToSchema, isNewerSchema } from "../store/schema-version";
import type { UnsavedChangesResult } from "../ui/ConfirmDialog";

interface DocumentLifecycleParams {
  tiptapRef: RefObject<any>;
  cmRef: RefObject<any>;
  engine: any;
  /** Project the markdown pane into the rich pane. Returns whether it actually
   *  ran — the sync engine gates out projections whose content is unchanged,
   *  and only a real one is a cost measurement for the scheduler. */
  syncMdToHtml: () => boolean;
  /** Project the rich pane into the markdown pane. See `syncMdToHtml`. */
  syncHtmlToMd: () => boolean;
  forceSyncMdToHtml: () => void;
  forceSyncHtmlToMd: () => void;
  resetHashes: () => void;
  setCanonical: (canonical: any, opts?: { resetHistory?: boolean }) => void;
  setFromHtml: (html: string) => void;
  switchToDoc: (docId: string, editor?: any) => Promise<any>;
  closeTab: (docId: string, editor?: any) => Promise<any>;
  createDoc: (content: string, format: IngestFormat, source: IngestSource, opts?: any) => any;
  deleteDoc: (docId: string, editor?: any) => Promise<any>;
  finalizeDoc: (doc: any, editor: Editor | null, skipPersist?: boolean) => Promise<any>;
  revertActiveDoc: () => Promise<any>;
  /** Resolves true only when the write committed (see documentStore). */
  saveActiveDoc: (editor: any) => Promise<boolean | void>;
  setDirty: () => void;
  handleCanonicalChange: (canonical: any) => void;
  pasteStyled: boolean;
  setPasteStyled: (styled: boolean) => void;
  syncMode: string;
  setSyncMode: (mode: string) => void;
  toast: { show: (message: string, type: "info" | "success" | "error" | "warning") => void };
  confirm: (options: { title: string; description?: string; confirmLabel?: string; destructive?: boolean }) => Promise<boolean>;
  confirmUnsaved: () => Promise<UnsavedChangesResult>;
}


export function useDocumentLifecycle({
  tiptapRef,
  cmRef,
  engine,
  syncMdToHtml,
  syncHtmlToMd,
  forceSyncMdToHtml,
  forceSyncHtmlToMd,
  resetHashes,
  setCanonical,
  setFromHtml,
  switchToDoc,
  closeTab,
  createDoc,
  deleteDoc,
  finalizeDoc,
  revertActiveDoc,
  saveActiveDoc,
  setDirty,
  handleCanonicalChange,
  pasteStyled,
  setPasteStyled,
  syncMode,
  setSyncMode,
  toast,
  confirm,
  confirmUnsaved,
}: DocumentLifecycleParams) {
  const mdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const htmlDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The post-paste force-sync (see handleHtmlPaste).
  const pasteSyncRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When the current burst of edits began, for the max-wait ceiling below.
  const mdPendingSinceRef = useRef(0);
  const htmlPendingSinceRef = useRef(0);
  const syncModeInitRef = useRef<boolean>(false);
  // Monotonic generation for document switches. handleSwitchDoc is async (it
  // awaits autosaveOnLeave + storage.get); if the user switches again before a
  // switch settles, the stale switch must NOT hydrate the editor — otherwise a
  // late-settling storage.get pushes the WRONG (or an already-superseded) doc's
  // content into the editor, blowing away anything typed into the doc that's
  // now current. Each switch captures its generation and bails at every await
  // boundary once a newer switch has bumped it (rapid-switch stale-settle).
  const switchGenRef = useRef(0);
  // Ref mirror of syncMdToHtml for use inside effects WITHOUT entering their
  // dep arrays (sync callbacks in deps re-trigger effects via the
  // onCanonicalChange → store → re-render chain — an infinite loop).
  const syncMdToHtmlRef = useRef(syncMdToHtml);
  useEffect(() => { syncMdToHtmlRef.current = syncMdToHtml; }, [syncMdToHtml]);

  /**
   * End any live IME / voice-dictation composition in either pane.
   *
   * Every OTHER composition rule in this file is "wait" — re-projecting
   * mid-composition aborts it and drops the streamed text. A document-LEAVING
   * path cannot wait: it is about to hydrate a different document over both
   * panes, so a composition it waits for is a composition whose text is
   * destroyed. Blurring ends it, and the browser commits the streamed text into
   * that pane's own document synchronously (measured; see the pane handles), so
   * the flush that follows carries real content into the canonical.
   *
   * Reproduced before this existed: dictate into the markdown pane, press ⌘N.
   * `flushAndCacheIfDirty` saw the composition's 120ms retry timer as "a
   * projection is pending", killed it, force-synced into the composition guard
   * (a no-op), and cached the RICH pane's JSON — which never received the
   * dictation. The text was gone from both panes and from disk.
   */
  const endCompositions = useCallback(() => {
    cmRef.current?.endComposition?.();
    tiptapRef.current?.endComposition?.();
  }, [cmRef, tiptapRef]);

  /**
   * Helper: Flush pending sync and cache unsaved edits if content has changed.
   * This ensures we capture the latest markdown edits before switching/closing.
   */
  const flushAndCacheIfDirty = useCallback(() => {
    // Cancel any pending debounced syncs. Only an ACTUALLY-pending md→html sync
    // is flushed: unconditionally forcing it re-projected the canonical through
    // the markdown pane on every switch, which permanently stripped inline
    // styles in "clean" mode (the clean MD projection has no style rules) and
    // clobbered fresh rich-pane edits with a stale MD pane.
    // These refs are not just timer handles, they are the "is a projection
    // pending?" ORACLE, so every site that cancels a timer must NULL the ref as
    // well. A cleared-but-parked id leaves this true until some md keystroke
    // happens to let `run()` clear it, and it would then force the projection
    // below on later document switches — the regression the note above
    // describes. Closing a tab and deleting a document both used to park one.
    //
    // HONEST SCOPE: latent, not demonstrated. Reaching it needs the close or
    // delete to land INSIDE the debounce window, and both are menu actions that
    // take far longer than that to perform — an instrumented build confirmed
    // `hadPendingMd` was false at every switch in the scenario. The window was
    // materially wider under the old size-based debounce (up to 800ms on a large
    // note) than it is now, so this is a trap being closed rather than a bug
    // being observed. It is still wrong, and the guard costs nothing.
    //
    // A composition is the case the paragraph above does NOT cover: its 120ms
    // retry loop keeps `mdDebounceRef` non-null for the whole utterance, so
    // `hadPendingMd` is true and the forced projection below runs — straight
    // into the sync engine's composition guard, which no-ops. End the
    // composition first so there is something real to flush.
    endCompositions();
    // A pending post-paste force-sync belongs to the document being left.
    if (pasteSyncRef.current) { clearTimeout(pasteSyncRef.current); pasteSyncRef.current = null; }
    const hadPendingMd = mdDebounceRef.current != null;
    if (mdDebounceRef.current) { clearTimeout(mdDebounceRef.current); mdDebounceRef.current = null; }
    if (htmlDebounceRef.current) { clearTimeout(htmlDebounceRef.current); htmlDebounceRef.current = null; }
    if (hadPendingMd) forceSyncMdToHtml();

    // Now check if content has actually changed
    const currentEditor = tiptapRef.current?.getEditor?.();
    const { activeDoc: currentActiveDoc, activeDocId, hydratedDocId, cacheUnsavedEdit, clearUnsavedEdit } = useDocumentStore.getState();

    if (!currentEditor || !currentActiveDoc || !activeDocId) return;
    // If the editor doesn't hold THIS document's content (un-hydrated), caching
    // its JSON would attach another doc's content as this doc's draft.
    if (hydratedDocId !== activeDocId) return;

    const currentCanonical = currentEditor.getJSON();
    // Compare against the persisted baseline, not the in-memory canonical which may be a cached draft
    const persistedCanonical = (currentActiveDoc as any)._persistedCanonical || currentActiveDoc.canonical;

    // Compare canonical content (simple JSON stringify for now)
    const hasChanges = JSON.stringify(currentCanonical) !== JSON.stringify(persistedCanonical);
    
    if (hasChanges) {
      cacheUnsavedEdit(activeDocId, currentCanonical);
    } else {
      // Clear stale cached draft when content matches the persisted baseline
      clearUnsavedEdit(activeDocId);
    }
  }, [forceSyncMdToHtml, endCompositions, tiptapRef]);

  /**
   * Best-effort autosave when LEAVING a document (switch / new doc). Without
   * this, everything typed since the last idle-autosave exists only as an
   * in-memory draft — so the sidebar word counts, link index, backlinks and
   * graph all disagree with what the user just wrote. Call AFTER
   * flushAndCacheIfDirty(): the draft it caches is both our dirty signal and
   * the safety net if the save fails (nothing is lost; the next explicit
   * save or idle autosave retries).
   */
  const autosaveOnLeave = useCallback(async () => {
    const s = useDocumentStore.getState();
    const { activeDocId, hydratedDocId } = s;
    if (!activeDocId || hydratedDocId !== activeDocId) return;
    if (!s.getUnsavedEdit(activeDocId)) return; // clean — nothing to persist
    const editor = tiptapRef.current?.getEditor?.();
    if (!editor) return;
    try {
      await saveActiveDoc(editor);
    } catch {
      // Draft stays cached; saving may legitimately refuse (multi-tab
      // conflict, quota). The user still has their content on screen.
    }
  }, [saveActiveDoc, tiptapRef]);

  // ── Projection scheduling ─────────────────────────────────────────────────
  // What a projection actually COSTS on this device, as a moving average of the
  // last few. The policy that turns it into delays is pure and lives in
  // ./sync-schedule.
  const syncCostRef = useRef(0);
  const recordSyncCost = useCallback((ms: number) => {
    syncCostRef.current = nextSyncCost(syncCostRef.current, ms);
  }, []);
  const nextWaitFrom = useCallback(
    (pendingSince: number) => nextSyncWait(syncCostRef.current, Date.now() - pendingSince),
    []
  );

  // After a md→html sync that ACTUALLY replaced the editor content, the editor
  // provably holds the active doc's content (the md pane is the active doc's
  // projection, synced wholesale). If hydration was never marked — e.g. the
  // editor mounted too slowly during init — mark it now, otherwise the user
  // would be locked out of saving for the whole session.
  // GUARD: only mark when the tiptap editor actually EXISTS. `syncMdToHtml`
  // early-returns when the editor isn't mounted yet (pushing nothing), so marking
  // hydrated there is a lie — the late-hydrate path would then see hydratedDocId
  // set and bail WITHOUT pushing the stored canonical, leaving the doc's content
  // on disk but invisible (and un-saveable via the blank backstop).
  const markHydratedAfterMdSync = useCallback(() => {
    if (!tiptapRef.current?.getEditor?.()) return;
    const s = useDocumentStore.getState();
    if (s.hydratedDocId == null && s.activeDocId) s.markHydrated(s.activeDocId);
  }, [tiptapRef]);

  const handleMdChange = useCallback(() => {
    // A burst starts at the first change with no timer already pending; the
    // ceiling is measured from there, so holding a key down cannot postpone the
    // projection indefinitely.
    if (mdDebounceRef.current) clearTimeout(mdDebounceRef.current);
    else mdPendingSinceRef.current = Date.now();
    const run = () => {
      // Wait out an active IME / voice-dictation composition in the pane this
      // projection WRITES — re-projecting into a composing editor aborts it and
      // drops the streamed text (Windows Voice dictation). This one writes the
      // rich pane, so only the rich pane's composition defers it; the markdown
      // pane is merely read. It used to check both, which meant dictating into
      // the markdown pane froze the mirror for the whole utterance — and, once a
      // CodeMirror composition flag got stuck on, forever. Mirrors the guard in
      // useSyncEngine.syncMdToHtml exactly; the two must agree, or this
      // reschedules for a projection the engine would run anyway.
      // Re-check shortly — compositionend brings the doc to rest and the next
      // tick flushes. The pending-since stamp is deliberately NOT reset here: a
      // composition defers the projection, it does not restart its clock.
      if (tiptapRef.current?.isComposing?.()) {
        mdDebounceRef.current = setTimeout(run, 120);
        return;
      }
      mdDebounceRef.current = null; // ref must clear on fire so "pending" checks are accurate
      // Only a projection that actually RAN is a cost measurement. Most calls
      // are gated out by the sync engine's hash / doc-identity checks and
      // return in microseconds; folding those into the average would drag it to
      // zero and make the scheduler treat every document as free.
      const t0 = performance.now();
      const projected = syncMdToHtml();
      if (projected) recordSyncCost(performance.now() - t0);
      // Only when the projection ACTUALLY ran. The function's own precondition
      // says so ("after a md→html sync that ACTUALLY replaced the editor
      // content"), but the call sites did not enforce it: syncMdToHtml returns
      // false for four reasons that all leave the editor untouched, and marking
      // hydrated then claims the editor holds this document's content when it
      // may hold the previous one's.
      if (projected) markHydratedAfterMdSync();
    };
    mdDebounceRef.current = setTimeout(run, nextWaitFrom(mdPendingSinceRef.current));
    setDirty();
  }, [syncMdToHtml, nextWaitFrom, recordSyncCost, setDirty, markHydratedAfterMdSync, cmRef, tiptapRef]);

  const handleHtmlChange = useCallback(() => {
    if (htmlDebounceRef.current) clearTimeout(htmlDebounceRef.current);
    else htmlPendingSinceRef.current = Date.now();
    const run = () => {
      // Composition guard — see handleMdChange. Mirror image: this projection
      // writes the markdown pane, so that is the pane whose composition defers
      // it (and it matches useSyncEngine.syncHtmlToMd).
      if (cmRef.current?.isComposing?.()) {
        htmlDebounceRef.current = setTimeout(run, 120);
        return;
      }
      htmlDebounceRef.current = null;
      const t0 = performance.now(); // see handleMdChange
      const projected = syncHtmlToMd();
      if (projected) recordSyncCost(performance.now() - t0);
    };
    htmlDebounceRef.current = setTimeout(run, nextWaitFrom(htmlPendingSinceRef.current));
    setDirty();
  }, [syncHtmlToMd, nextWaitFrom, recordSyncCost, setDirty, cmRef, tiptapRef]);

  const handleHtmlPaste = useCallback((html: string, mods?: { shiftKey?: boolean }) => {
    // Shift INVERTS the preference rather than forcing styled. With styled as the
    // default, `shiftKey || pasteStyled` was always true and the modifier meant
    // nothing; as an inversion it is "paste the other way" whichever way you have
    // it set, which is useful in both directions.
    //
    // The flag arrives as an explicit argument, NOT off a ClipboardEvent: that
    // interface does not inherit from UIEvent and has no `shiftKey` at all, so
    // reading it off the event (which is what this did) was always `undefined`
    // and the inversion never once fired. TiptapPane sources it from the view.
    const styled = mods?.shiftKey ? !pasteStyled : pasteStyled;
    const cleaned = styled ? sanitizePastedHtml(html) : cleanPasteHtml(html);
    const editor = tiptapRef.current?.getEditor();
    if (editor) {
      editor.chain().focus().insertContent(cleaned).run();
      // Captured, not fire-and-forget: this used to be one uncancelled timer per
      // paste, so it could still land after the document had been switched away
      // (marking the WRONG document dirty) or after the editor unmounted.
      if (pasteSyncRef.current) clearTimeout(pasteSyncRef.current);
      pasteSyncRef.current = setTimeout(() => {
        pasteSyncRef.current = null;
        forceSyncHtmlToMd();
        setDirty();
      }, 100);
    }
    toast.show(styled ? "Pasted with styles" : "Pasted — styles stripped", "info");
    // No auto-reset: this is a persisted PREFERENCE now, not a one-shot arm. It
    // used to disarm itself after every styled paste, which was coherent only
    // while the default was "strip styles".
    return true;
  }, [forceSyncHtmlToMd, setDirty, toast, pasteStyled, setPasteStyled, tiptapRef]);

  // Clear the sync debounce timers on unmount. Switch/close/delete already flush
  // them, but if the editor itself unmounts within a sync-delay of a keystroke
  // (relevant for library/iframe embed hosts that mount/unmount the editor), the
  // pending setTimeout would otherwise fire against torn-down refs and write to
  // the store post-unmount. The standalone app never unmounts PE, so this is a
  // no-op there.
  useEffect(() => {
    return () => {
      if (mdDebounceRef.current) clearTimeout(mdDebounceRef.current);
      if (htmlDebounceRef.current) clearTimeout(htmlDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!syncModeInitRef.current) {
      syncModeInitRef.current = true;
      return;
    }
    // Persist syncMode through the storage adapter so the editor never writes
    // to localStorage directly.
    const storage = useDocumentStore.getState().getStorage();
    storage.getPrefs().then((prefs) => {
      storage.setPrefs({ ...prefs, syncMode }).catch(() => {});
    }).catch(() => {});
    // Flush any pending md→html debounce FIRST: the forced html→md below
    // re-projects the rich pane over the md pane, which would discard the last
    // source-pane typing that has not been projected yet. Called through a
    // REF — sync
    // callbacks must never enter effect dep arrays (see CLAUDE.md invariant;
    // doing so wired an infinite update loop through onCanonicalChange).
    // Both projections below are composition-gated no-ops while an IME is
    // live, and clearing the timer would strand the retry loop that is the
    // deferred projection's only wake-up. End it instead.
    endCompositions();
    if (mdDebounceRef.current) { clearTimeout(mdDebounceRef.current); mdDebounceRef.current = null; }
    syncMdToHtmlRef.current();
    forceSyncHtmlToMd();
  }, [syncMode, forceSyncHtmlToMd, endCompositions]);

  const handleSyncModeChange = useCallback((newMode: string) => {
    setSyncMode(newMode);
    toast.show(
      newMode === "styled"
        ? "Styled — inline styles visible in markdown"
        : "Clean — styles hidden in markdown",
      "info"
    );
  }, [setSyncMode, toast]);

  /**
   * Capture the given doc's pane states (undo history + cursor) into the
   * per-doc history cache — only when the editor verifiably holds that doc.
   * PM/CM states are immutable, so this is a reference grab, not a copy.
   * Called on EVERY departure path (switch, new-doc), not just handleSwitchDoc.
   */
  const captureHistoryFor = useCallback((docId: string | null) => {
    if (!docId) return;
    if (useDocumentStore.getState().hydratedDocId !== docId) return;
    const tiptapState = tiptapRef.current?.getEditorState?.();
    if (!tiptapState) return;
    historyCache.capture(
      docId,
      tiptapState,
      tiptapState.doc.toJSON(),
      cmRef.current?.getEditorState?.() ?? null,
      cmRef.current?.getValue?.() ?? "",
      tiptapRef.current?.getUndoDepth?.() ?? 0
    );
  }, [tiptapRef, cmRef]);

  /**
   * After hydrating `docId`, either restore its cached history (validated
   * against the just-hydrated content) or fall back to fresh history. The
   * hydration itself must have been done with { resetHistory: false }.
   */
  const restoreOrResetHistory = useCallback((docId: string) => {
    const currentDoc = tiptapRef.current?.getEditorState?.()?.doc.toJSON();
    const cached = currentDoc
      ? historyCache.takeForRestore(docId, currentDoc, cmRef.current?.getValue?.() ?? null)
      : null;
    if (cached) {
      tiptapRef.current?.restoreEditorState?.(cached.tiptapState);
      if (cached.cmValid && cached.cmState) cmRef.current?.restoreEditorState?.(cached.cmState);
      else cmRef.current?.resetHistory?.();
    } else {
      tiptapRef.current?.resetHistory?.();
      cmRef.current?.resetHistory?.();
    }
  }, [tiptapRef, cmRef]);

  // Read-only that WE switched on for a document from a newer build, and what
  // it was before — restored when a document that fits is hydrated again.
  const forcedReadOnlyRef = useRef<{ prev: boolean } | null>(null);

  /**
   * THE hydration ritual — the invariant-critical sequence for putting a
   * document's content into the live editor. Every step matters:
   * resetHashes (else stale hash-gating suppresses the next sync), push the
   * canonical, restore-or-reset undo history, markHydrated (else saves are
   * blocked), notify. This was previously copy-pasted at 5 call sites; each
   * copy was a chance to forget a step (and one did, historically).
   *
   * Content that does not fit the live schema — or claims a NEWER schema
   * version (see schema-version.ts) — would load as an EMPTY document, and the
   * next keystroke's autosave would write that over the real one. It is shown
   * as a best-effort display copy instead, read-only, and the document is NOT
   * marked hydrated, so no save path can persist the copy.
   */
  const hydrateEditorWithDoc = useCallback((docId: string, canonical: unknown, opts?: { keepHistory?: boolean }) => {
    const store = useDocumentStore.getState();
    const schema = tiptapRef.current?.getEditor?.()?.schema;
    const record = store.activeDoc?.id === docId ? store.activeDoc : null;
    const misfit = schema ? canonicalMisfit(canonical, schema) : null;
    const incompatible = !!misfit || isNewerSchema(record?.schemaVersion);
    const shown = misfit && schema ? coerceToSchema(canonical, schema) : canonical;

    resetHashes();
    if (opts?.keepHistory) {
      // Same-document content replacement (e.g. revert): keep undo history.
      setCanonical(shown, { resetHistory: false });
    } else {
      // Cross-document hydration: restore the target's cached history when
      // valid, otherwise fresh history.
      setCanonical(shown, { resetHistory: false });
      restoreOrResetHistory(docId);
    }
    if (incompatible) {
      store.markIncompatible(docId, misfit ?? "written by a newer version");
      const ui = useUIStore.getState();
      if (!forcedReadOnlyRef.current) forcedReadOnlyRef.current = { prev: ui.readOnly };
      useUIStore.setState({ readOnly: true }); // session-only, never the persisted pref
      toast.show(
        `“${record?.title || "This document"}” was made by a newer version of the app, or holds content this version cannot show. It is open read-only so nothing is lost.`,
        "warning"
      );
    } else {
      store.clearIncompatible(docId);
      store.markHydrated(docId);
      if (forcedReadOnlyRef.current) {
        useUIStore.setState({ readOnly: forcedReadOnlyRef.current.prev });
        forcedReadOnlyRef.current = null;
      }
    }
    handleCanonicalChange(shown);
  }, [resetHashes, setCanonical, restoreOrResetHistory, handleCanonicalChange, tiptapRef, toast]);

  /**
   * Claim or merely observe the editor's switch generation.
   *
   * A path that is going to HYDRATE the editor claims it (increments), which
   * invalidates any in-flight switch — the newer path owns the editor now.
   * A path that will NOT hydrate must only OBSERVE it: bumping the generation
   * there kills an in-flight switch's hydration and puts nothing in its place,
   * leaving activeDocId set with hydratedDocId null. Every save is then refused,
   * and the first markdown keystroke marks the editor hydrated while it still
   * holds the PREVIOUS document — a cross-document overwrite.
   *
   * Closing or deleting a BACKGROUND document is exactly that case: it changes
   * the library, not the editor.
   */
  const claimEditorGeneration = useCallback((willHydrate: boolean) =>
    willHydrate ? ++switchGenRef.current : switchGenRef.current, []);

  const handleSwitchDoc = useCallback(async (docId: string) => {
    // Only proceed if we're actually switching to a different document
    const { activeDocId } = useDocumentStore.getState();
    if (docId === activeDocId) return;

    // Claim this switch's generation. Every await below re-checks it: if a newer
    // switch bumped the generation while we were awaiting, THIS switch is stale
    // and must abort before mutating the editor — the newer switch owns the
    // editor now. Without this, a slow storage.get for an abandoned switch would
    // hydrate the editor with the wrong doc and clobber live edits.
    const myGen = ++switchGenRef.current;

    // Flush pending sync and cache any unsaved changes, then persist them so
    // the doc we're leaving is truly saved (word counts / links / graph stay
    // honest). History capture must happen before hydrating the next doc.
    flushAndCacheIfDirty();
    captureHistoryFor(activeDocId);
    await autosaveOnLeave();
    // Superseded during the leave-autosave: don't even touch the store — the
    // newer switch's switchToDoc has (or will) set active + hydrate correctly.
    if (switchGenRef.current !== myGen) return;

    const editor = tiptapRef.current?.getEditor?.();
    const doc = await switchToDoc(docId, editor);
    // Superseded during the storage read: the editor still holds prior content
    // (or the user's fresh edits). Hydrating now would overwrite them.
    if (switchGenRef.current !== myGen) return;
    if (!doc && useDocumentStore.getState().activeDocId !== docId) {
      // The store stayed where it was: the document is gone (deleted in
      // another tab) or could not be read. Say so — a click that silently
      // does nothing reads as a broken library.
      toast.show("That document could not be opened", "error");
      return;
    }
    if (doc?.canonical) {
      hydrateEditorWithDoc(docId, doc.canonical);
    } else if (doc && cmRef.current) {
      try {
        const html = doc._ingestHtml || "";
        const md = html && engine
          ? engine.htmlToMd(html)
          : "# " + (doc.title || "Untitled") + "\n\n";
        cmRef.current.setValue(md);
        // PUSH the content into the rich editor before marking hydrated —
        // setValue alone is update-suppressed (no sync fires), so marking
        // without pushing would let a save persist the PREVIOUS doc's content.
        if (engine) setFromHtml(html || engine.mdToHtml(md));
        useDocumentStore.getState().markHydrated(docId);
      } catch (e) {
        console.warn("[switchDoc] CM6 fallback failed:", e);
      }
    }
  }, [flushAndCacheIfDirty, captureHistoryFor, autosaveOnLeave, restoreOrResetHistory, switchToDoc, resetHashes, setCanonical, setFromHtml, handleCanonicalChange, engine, tiptapRef, cmRef, toast]);

  const handleCloseTab = useCallback(async (docId: string) => {
    // Generation guard: this path awaits a user dialog and/or storage before it
    // hydrates. If a newer switch/close/delete has claimed the editor in the
    // meantime, hydrating here pushes THIS path's document into an editor that
    // now holds a different one — the exact stale-settle handleSwitchDoc guards
    // against, reached through a door that never claimed a generation. Closing a
    // BACKGROUND tab normally hydrates nothing, so it observes rather than
    // claims — bumping the generation there would invalidate an in-flight
    // switch's hydration and put nothing in its place. `let`, because ONE
    // background branch does hydrate (saving a background tab's cached draft),
    // and it claims at that point instead: see the re-claim below.
    let myGen = claimEditorGeneration(docId === useDocumentStore.getState().activeDocId);
    // Check if the tab being closed is the active (dirty) one
    const { saveStatus, activeDocId, clearUnsavedEdit, getUnsavedEdit } = useDocumentStore.getState();
    // An error/conflict/blocked save still leaves live unsaved content, and
    // "saving" has not committed it yet. None of those states guarantees a
    // cached draft: closing must offer the same choice as ordinary editing.
    const hasUnsavedContent = saveStatus === "editing" || saveStatus === "saving" ||
      saveStatus === "error" || saveStatus === "conflict" || saveStatus === "blocked" ||
      saveStatus === "full";
    if (docId === activeDocId && hasUnsavedContent) {
      const result = await confirmUnsaved();
      if (result === "cancel") return;
      // The dialog can outlive this document's ownership of the editor. Do not
      // save/discard the replacement document after an intervening switch.
      if (switchGenRef.current !== myGen || useDocumentStore.getState().activeDocId !== docId) return;
      if (result === "save") {
        // Flush any pending Markdown → HTML sync before saving
        flushAndCacheIfDirty();
        const editor = tiptapRef.current?.getEditor?.();
        if (!editor) {
          toast.show("Save unavailable — the document was not closed", "error");
          return;
        }
        try {
          await saveActiveDoc(editor);
        } catch (e) {
          console.warn("[handleCloseTab] Save failed — keeping the tab open:", e);
          toast.show("Save failed — the document was not closed", "error");
          return;
        }
        const afterSave = useDocumentStore.getState();
        if (switchGenRef.current !== myGen || afterSave.activeDocId !== docId) return;
        // saveActiveDoc also resolves on a blocked write or a non-quota error;
        // resolution alone is not a commit. Typing during the write likewise
        // leaves "editing", so keep the live document rather than closing it.
        if (afterSave.saveStatus !== "saved" && afterSave.saveStatus !== "ready") {
          toast.show("Document still has unsaved changes — it was not closed", "warning");
          return;
        }
      } else if (result === "discard") {
        // Clear timers and cached edit when discarding. NULL the refs, don't
        // just clear the timers — see the note on flushAndCacheIfDirty below.
        // End any composition first: the tab is going away, so its retry loop
        // has nothing left to project into and would otherwise stream the rest
        // of the utterance into whichever document opens next.
        endCompositions();
        if (mdDebounceRef.current) { clearTimeout(mdDebounceRef.current); mdDebounceRef.current = null; }
        if (htmlDebounceRef.current) { clearTimeout(htmlDebounceRef.current); htmlDebounceRef.current = null; }
        clearUnsavedEdit(docId);
      }
    } else {
      // If closing a non-active tab, check if it has cached unsaved edits
      const cachedEdit = getUnsavedEdit(docId);
      if (cachedEdit) {
        const result = await confirmUnsaved();
        if (result === "cancel") return;
        if (result === "save") {
          // To save a background tab: flush the current doc, switch to the
          // target, then EXPLICITLY hydrate the editor with the cached draft.
          // (The old code polled for hydration that nothing ever performed —
          // the poll always timed out, the save silently never happened, and
          // the store/editor mismatch let autosave cross-contaminate docs.)
          flushAndCacheIfDirty();

          const editor = tiptapRef.current?.getEditor?.();
          const doc = await switchToDoc(docId, editor);
          if (switchGenRef.current !== myGen) return;
          const freshEditor = tiptapRef.current?.getEditor?.();
          if (doc && freshEditor) {
            // This branch DOES take the editor — it pushes the background tab's
            // cached draft into it — so claim the generation now, at the point
            // the claim is true. Observing one at entry and hydrating here left
            // this path comparing against a generation it never owned, and left
            // an in-flight switch free to settle on top of the draft.
            myGen = claimEditorGeneration(true);
            hydrateEditorWithDoc(docId, cachedEdit);
            try {
              // Resolution is not a commit (see saveActiveDoc) — only say
              // "Saved" when the write landed.
              const committed = await saveActiveDoc(freshEditor);
              toast.show(committed ? "Saved" : "Not saved — the draft is still open", committed ? "success" : "warning");
            } catch (e) {
              console.warn("[handleCloseTab] Background save failed:", e);
              toast.show("Save failed", "error");
            }
          }
          // Don't close the tab after saving - let the user decide
          return;
        } else if (result === "discard") {
          clearUnsavedEdit(docId);
        }
      }
      // No cached edits, safe to close without prompting
    }

    // Clear any remaining timers before closing (nulled, see below). A live
    // composition ends here for the same reason as in the discard branch.
    endCompositions();
    if (mdDebounceRef.current) { clearTimeout(mdDebounceRef.current); mdDebounceRef.current = null; }
    if (htmlDebounceRef.current) { clearTimeout(htmlDebounceRef.current); htmlDebounceRef.current = null; }

    // Closing a tab discards its editing context — including cached history
    // (matches VS Code: reopening a closed file starts with fresh undo).
    historyCache.drop(docId);

    const editor = tiptapRef.current?.getEditor?.();
    const switchedDoc = await closeTab(docId, editor);
    if (switchGenRef.current !== myGen) return;
    if (switchedDoc?.canonical) {
      hydrateEditorWithDoc(switchedDoc.id, switchedDoc.canonical);
    }
  }, [closeTab, hydrateEditorWithDoc, saveActiveDoc, confirmUnsaved, switchToDoc, flushAndCacheIfDirty, endCompositions, claimEditorGeneration, tiptapRef, toast]);

  const handleRevertDoc = useCallback(async () => {
    // Generation guard — see handleCloseTab. This one awaits a confirm dialog,
    // which is unbounded: the user can switch documents while it is open.
    const myGen = claimEditorGeneration(true);
    // Revert destroys the live (unsaved) version — confirm when there IS one.
    // Especially important when autosave has been failing: the stored copy may
    // be arbitrarily old, and revert would discard the only current copy.
    // Every status that leaves unsaved content on screen — the same set closing
    // a document asks for. Revert used to confirm only for "editing"/"error",
    // so a document parked on a terminal status (conflict, blocked, full) was
    // reverted, and its only copy discarded, without a question.
    const { saveStatus } = useDocumentStore.getState();
    if (saveStatus === "editing" || saveStatus === "error" || saveStatus === "saving" ||
        saveStatus === "conflict" || saveStatus === "blocked" || saveStatus === "full") {
      const ok = await confirm({
        title: "Revert to last saved version?",
        description: "Your unsaved changes will be discarded. This cannot be undone.",
        confirmLabel: "Revert",
        destructive: true,
      });
      if (!ok) return;
    }
    let doc: any;
    try {
      doc = await revertActiveDoc();
    } catch {
      // The saved copy could not be READ (not merely absent): keep what is on
      // screen rather than replacing it with nothing.
      toast.show("The saved version could not be read — nothing was reverted", "error");
      return;
    }
    if (switchGenRef.current !== myGen) return;
    if (!doc) return;
    if (doc.canonical) {
      // Revert replaces content of the SAME document — keep undo history so
      // a confirmed-but-regretted revert can still be undone with ⌘Z (no
      // cross-document risk; history dropping is only for doc switches).
      hydrateEditorWithDoc(doc.id, doc.canonical, { keepHistory: true });
    } else if (cmRef.current && doc._ingestHtml && engine) {
      resetHashes();
      const md = engine.htmlToMd(doc._ingestHtml);
      cmRef.current.setValue(md);
    }
    toast.show("Reverted to last saved version", "info");
  }, [revertActiveDoc, resetHashes, setCanonical, handleCanonicalChange, engine, cmRef, toast, confirm]);

  const handleNewDoc = useCallback(async () => {
    // Generation guard — see handleCloseTab. This one awaits an autosave and
    // then polls for the editor for up to 2s, which is ample room for the user
    // to open a different document in between.
    const myGen = claimEditorGeneration(true);
    // Flush pending sync and cache any unsaved changes; capture the departing
    // doc's undo history so switching back to it restores ⌘Z; then persist the
    // departing doc so it doesn't linger as a stale draft.
    flushAndCacheIfDirty();
    captureHistoryFor(useDocumentStore.getState().activeDocId);
    await autosaveOnLeave();
    if (switchGenRef.current !== myGen) return;

    // ── Unique title: "Untitled", "Untitled 2", "Untitled 3", … ──
    // Check both persisted documents and open tabs (which may include unsaved
    // docs not yet reflected in the documents list).
    const { documents, openTabs } = useDocumentStore.getState();
    const existingTitles = new Set([
      ...documents.map((d) => d.title),
      ...openTabs.map((t) => t.title),
    ]);
    let title = "Untitled";
    let counter = 2;
    while (existingTitles.has(title)) {
      title = `Untitled ${counter++}`;
    }

    const mdToHtml =
      engine?.mdToHtml ?? useDocumentStore.getState()._engine?.mdToHtml;
    const doc = createDoc(``, "markdown", "user-typed", { mdToHtml });
    if (!doc) {
      console.warn("[handleNewDoc] createDoc returned null — engine not ready");
      return;
    }
    // Display placeholder only — deliberately NOT pinned as userTitle. Pinning
    // here made content derivation permanently dead: every in-app doc stayed
    // "Untitled N" forever even after the user typed "# Real Title". The first
    // save/autosave now derives the title from the first heading (see
    // resolveDocTitle); an explicit rename still pins.
    doc.userTitle = null;
    doc.title = title;
    const html = doc._ingestHtml || `<p></p>`;

    // Activate the doc in the store FIRST (without persisting) so EditorLayout 
    // mounts and the Tiptap editor becomes available.
    setFromHtml(html);
    await finalizeDoc(doc, tiptapRef.current?.getEditor?.() ?? null, true);

    // Now wait for the Tiptap editor to appear (it may need a render cycle).
    const editor = await new Promise<any>((resolve) => {
      const start = Date.now();
      const check = () => {
        const ed = tiptapRef.current?.getEditor?.();
        if (ed) return resolve(ed);
        if (Date.now() - start > 2000) return resolve(null);
        requestAnimationFrame(check);
      };
      check();
    });
    if (switchGenRef.current !== myGen) return;

    if (!editor) {
      console.warn("[handleNewDoc] Tiptap editor not ready after 2s");
      // Persist anyway with what we have
      try {
        await finalizeDoc(doc, null, false);
      } catch {
        toast.show(`"${title}" could not be saved — storage may be full.`, "error");
      }
      return;
    }

    // Capture the canonical from the mounted editor and persist. finalizeDoc
    // now rethrows persistence failures — surface them instead of reporting
    // "Created" for a document that never reached storage.
    handleCanonicalChange(editor.getJSON());
    try {
      await finalizeDoc(doc, editor, false);
      toast.show(`Created: ${title}`, "info");
    } catch {
      toast.show(`"${title}" could not be saved — storage may be full. It exists only in this session.`, "error");
    }
  }, [flushAndCacheIfDirty, autosaveOnLeave, createDoc, engine, setFromHtml, finalizeDoc, handleCanonicalChange, toast, tiptapRef]);

  const handleDeleteDoc = useCallback(async (docId: string, skipConfirm = false) => {
    // Generation guard — see handleCloseTab. Deleting a BACKGROUND document
    // hydrates nothing, so it observes the generation rather than claiming it.
    const myGen = claimEditorGeneration(docId === useDocumentStore.getState().activeDocId);
    if (!skipConfirm) {
      const ok = await confirm({ title: "Delete document?", description: "This action cannot be undone.", confirmLabel: "Delete", destructive: true });
      if (!ok) return;
    }
    endCompositions(); // the document is going away — see handleCloseTab
    if (mdDebounceRef.current) { clearTimeout(mdDebounceRef.current); mdDebounceRef.current = null; }
    if (htmlDebounceRef.current) { clearTimeout(htmlDebounceRef.current); htmlDebounceRef.current = null; }
    historyCache.drop(docId); // deleted docs must not linger in the history cache
    const editor = tiptapRef.current?.getEditor?.();
    const switchedDoc = await deleteDoc(docId, editor);
    if (switchGenRef.current !== myGen) return;
    if (switchedDoc?.canonical) {
      hydrateEditorWithDoc(switchedDoc.id, switchedDoc.canonical);
    }
    toast.show("Deleted", "info");
  }, [deleteDoc, resetHashes, setCanonical, handleCanonicalChange, toast, tiptapRef, confirm, endCompositions, claimEditorGeneration]);

  /**
   * Restore a snapshot INTO the active document. The current live content is
   * snapshotted first (reason "pre-restore") so the restore is itself
   * reversible, then the snapshot content is hydrated and persisted. Same-doc
   * content replacement keeps undo history so ⌘Z reverts the restore too.
   */
  const restoreSnapshotInPlace = useCallback(async (snapshotId: number) => {
    // A restore REPLACES the document's content, marks it dirty and saves it —
    // an edit by any definition, and read-only let it straight through (the
    // dispatcher's guard never sees this path). Refused, and said so. Checked
    // again after the await: read-only can be switched on while the version
    // loads.
    const refuseReadOnly = () => {
      if (!useUIStore.getState().readOnly) return false;
      toast.show("Read-only is on — turn it off to restore a version", "warning");
      return true;
    };
    if (refuseReadOnly()) return;
    // Generation guard — see handleCloseTab.
    const myGen = claimEditorGeneration(true);
    const { activeDocId, activeDoc } = useDocumentStore.getState();
    if (!activeDocId) return;
    const canonical = await snapshotStore.getCanonical(snapshotId);
    if (switchGenRef.current !== myGen) return;
    if (!canonical) { toast.show("That version could not be loaded", "error"); return; }
    if (refuseReadOnly()) return;

    const editor = tiptapRef.current?.getEditor?.();
    if (editor) {
      try {
        await snapshotStore.record(activeDocId, activeDoc?.title ?? "Untitled", editor.getJSON(), "pre-restore");
      } catch { /* best effort — don't block the restore on the safety snapshot */ }
    }
    if (switchGenRef.current !== myGen) return;
    hydrateEditorWithDoc(activeDocId, canonical, { keepHistory: true });
    setDirty();
    const ed = tiptapRef.current?.getEditor?.();
    if (ed) { try { await saveActiveDoc(ed); } catch { /* stays as a dirty draft */ } }
    toast.show("Version restored", "success");
  }, [hydrateEditorWithDoc, setDirty, saveActiveDoc, toast, tiptapRef]);

  /**
   * Restore a snapshot as a BRAND-NEW document (non-destructive — the source
   * doc is untouched). Used for recovering deleted documents and for keeping the
   * current version while inspecting an old one.
   */
  const restoreSnapshotAsNew = useCallback(async (meta: SnapshotMeta) => {
    const canonical = await snapshotStore.getCanonical(meta.id);
    if (!canonical) { toast.show("That version could not be loaded", "error"); return; }

    // Claim a new switch generation: this creates + activates a new doc, so any
    // in-flight handleSwitchDoc must not later clobber it (mirrors the switch guard).
    const myGen = claimEditorGeneration(true);

    // Persist the doc we're leaving first (as handleNewDoc does).
    flushAndCacheIfDirty();
    captureHistoryFor(useDocumentStore.getState().activeDocId);
    await autosaveOnLeave();
    // Re-check BEFORE anything is created or activated. handleNewDoc does the
    // same here, and for the same reason: `finalizeDoc` below sets activeDocId
    // WITHOUT setting hydratedDocId, so a superseded run that only checked
    // after it would abort having already split the two — and every save is
    // refused for the rest of the session once they disagree.
    if (switchGenRef.current !== myGen) return;

    const { documents, openTabs } = useDocumentStore.getState();
    const existing = new Set([...documents.map((d) => d.title), ...openTabs.map((t) => t.title)]);
    const base = `${meta.title || "Untitled"} (restored)`;
    let title = base;
    let n = 2;
    while (existing.has(title)) title = `${base} ${n++}`;

    const doc = createDocument({ title, userTitle: title, canonical });
    // Persist + activate (no editor yet), then hydrate the mounted editor.
    await finalizeDoc(doc, null, false);
    const editor = await new Promise<any>((resolve) => {
      const start = Date.now();
      const check = () => {
        const ed = tiptapRef.current?.getEditor?.();
        if (ed) return resolve(ed);
        if (Date.now() - start > 2000) return resolve(null);
        requestAnimationFrame(check);
      };
      check();
    });
    if (switchGenRef.current !== myGen) {
      // Superseded during the editor poll — the newer switch owns the editor.
      // Do not hydrate, but do not leave the ids split either: `finalizeDoc`
      // above already moved activeDocId, so repair by hydrating whatever the
      // store now considers active. Same hand-off addDocumentsImpl performs.
      const store = useDocumentStore.getState();
      if (store.activeDocId && store.hydratedDocId !== store.activeDocId) {
        const rec = await store.getDocById(store.activeDocId).catch(() => null);
        if (rec?.canonical) hydrateEditorWithDoc(rec.id, rec.canonical);
      }
      return;
    }
    if (editor) hydrateEditorWithDoc(doc.id, canonical);
    toast.show(`Restored as "${title}"`, "success");
  }, [flushAndCacheIfDirty, captureHistoryFor, autosaveOnLeave, finalizeDoc, hydrateEditorWithDoc, claimEditorGeneration, toast, tiptapRef]);

  const cancelPendingSync = useCallback(() => {
    // Same rule as flushPendingSync below: while a composition is live, the
    // 120ms reschedule loop IS the deferred projection's only retry. Clearing
    // it here (⌘Z routes through this) left the panes permanently out of step
    // — the dictated text sat in one pane and never reached the other, and the
    // canonical autosave persists is the rich pane's.
    if (cmRef.current?.isComposing?.() || tiptapRef.current?.isComposing?.()) return;
    if (mdDebounceRef.current) { clearTimeout(mdDebounceRef.current); mdDebounceRef.current = null; }
    if (htmlDebounceRef.current) { clearTimeout(htmlDebounceRef.current); htmlDebounceRef.current = null; }
    if (pasteSyncRef.current) { clearTimeout(pasteSyncRef.current); pasteSyncRef.current = null; }
  }, [cmRef, tiptapRef]);

  const flushPendingSync = useCallback(() => {
    // While an IME / voice-dictation composition is active, do NOT clear the
    // pending debounce (its reschedule loop is the deferred projection's only
    // retry — see handleMdChange) and do NOT force a sync (it would no-op mid-
    // composition anyway). Autosave still persists the canonical from getJSON();
    // the projection flushes once the composition settles. Clearing here would
    // strand MD-pane dictated text until the next keystroke.
    if (cmRef.current?.isComposing?.() || tiptapRef.current?.isComposing?.()) return;
    if (mdDebounceRef.current) { clearTimeout(mdDebounceRef.current); mdDebounceRef.current = null; }
    if (htmlDebounceRef.current) { clearTimeout(htmlDebounceRef.current); htmlDebounceRef.current = null; }
    if (syncMdToHtml()) markHydratedAfterMdSync();   // see handleMdChange
    syncHtmlToMd();
  }, [syncMdToHtml, syncHtmlToMd, markHydratedAfterMdSync, cmRef, tiptapRef]);

  useEffect(() => () => {
    if (mdDebounceRef.current) clearTimeout(mdDebounceRef.current);
    if (htmlDebounceRef.current) clearTimeout(htmlDebounceRef.current);
    if (pasteSyncRef.current) clearTimeout(pasteSyncRef.current);
  }, []);

  /**
   * Everything a path must do BEFORE it takes the editor away from the document
   * it is currently showing: flush the pending pane sync, cache the draft, keep
   * the undo stack, and try one last save.
   *
   * Exposed because import is a document-leaving path too. It used to activate
   * the imported document and overwrite both panes with no flush at all, so
   * anything typed in the last autosave window was destroyed — not on disk, not
   * in the draft cache, not in undo. Every OTHER leaving path (switch, close,
   * new) already did this; import simply never called it.
   */
  const prepareToLeaveActiveDoc = useCallback(async () => {
    const { activeDocId } = useDocumentStore.getState();
    if (!activeDocId) return;
    flushAndCacheIfDirty();
    captureHistoryFor(activeDocId);
    await autosaveOnLeave();
  }, [flushAndCacheIfDirty, captureHistoryFor, autosaveOnLeave]);

  /**
   * The EDITOR is going away (a host unmounting the component) — a
   * document-leaving path like any other, but synchronous, because the panes
   * are about to be destroyed. Must run while they still exist (a layout
   * cleanup: React runs a parent's before its children's).
   *
   * The store is a module singleton and outlives the editor. It used to keep
   * `hydratedDocId` pointing at the open document while the NEXT editor
   * instance started empty — every guard passed, and the first keystroke in the
   * remounted editor saved over that document. So: flush the pending
   * projection and cache the draft as every leaving path does, release the
   * hydration mark, stash the draft synchronously (the page may close while
   * no editor — and so no unload handler — exists), and write it through.
   */
  const releaseEditor = useCallback(() => {
    flushAndCacheIfDirty();
    const s = useDocumentStore.getState();
    const id = s.activeDocId;
    const draft = id && s.hydratedDocId === id ? s.getUnsavedEdit(id) : undefined;
    if (id && draft) stashUnsaved(collectUnloadStash(s, draft, Date.now()));
    s.markHydrated(null);
    useUIStore.getState().setEditorReady(false); // no typing into an editor nobody hydrated
    if (id && draft) {
      s.patchDocById(id, { canonical: draft })
        .then(() => {
          const now = useDocumentStore.getState();
          if (now.getUnsavedEdit(id) === draft) now.clearUnsavedEdit(id);
        })
        .catch(() => { /* the draft stays cached (and stashed) for the next mount */ });
    }
  }, [flushAndCacheIfDirty]);

  return {
    handleMdChange,
    handleHtmlChange,
    handleHtmlPaste,
    handleSyncModeChange,
    handleSwitchDoc,
    prepareToLeaveActiveDoc,
    hydrateEditorWithDoc,
    handleCloseTab,
    handleRevertDoc,
    handleNewDoc,
    handleDeleteDoc,
    restoreSnapshotInPlace,
    restoreSnapshotAsNew,
    cancelPendingSync,
    flushPendingSync,
    releaseEditor,
  };
}
