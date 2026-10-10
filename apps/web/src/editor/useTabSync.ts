import { useEffect, useRef } from "react";
import { createDocument, type DocumentRecord } from "../store/documents/document";
import { describeUncommittedSave, useDocumentStore } from "../store/documents/documentStore";
import { useFolderStore, type FolderRecord } from "../store/documents/folders";
import { historyCache } from "../store/history/history-cache";
import { snapshotStore } from "../store/history/snapshot-store";
import {
  decideOpenDocChange,
  folderStructureSignature,
  hasUnsavedWork,
  isDeletedElsewhere,
  isForeignRevision,
  markDeletedElsewhere,
  startTabSync,
  summarizeEvents,
  useTabSyncStore,
  withRemoteApply,
  type OpenDocState,
  type TabNotice,
  type TabSyncEvent,
} from "../store/persistence/tab-sync";
import { useUIStore } from "../store/preferences/uiStore";
import { t } from "../i18n";
import type { CmRef, Lifecycle, TiptapRef, Toast } from "./types";

/** Events that arrive together (an import, a bulk delete) are handled together. */
const BATCH_MS = 40;
/** A deferred reload looks again this often, for at most this long. */
const RETRY_MS = 150;
const RETRY_FOR_MS = 20_000;
/** "Updated from another tab" at most once per this long — a tab saving every
 *  few seconds must not bury a reader in toasts. */
const QUIET_TOAST_MS = 15_000;
/** How many times a resolution re-reads the panes because the user typed
 *  while it was keeping a copy, before it asks them to try again. */
const SETTLE_ATTEMPTS = 3;

interface TabSyncParams {
  tiptapRef: TiptapRef;
  cmRef: CmRef;
  hydrateEditorWithDoc: Lifecycle["hydrateEditorWithDoc"];
  claimEditorGeneration: Lifecycle["claimEditorGeneration"];
  isEditorGeneration: Lifecycle["isEditorGeneration"];
  endCompositions: Lifecycle["endCompositions"];
  hasPendingProjection: Lifecycle["hasPendingProjection"];
  flushPendingSync: Lifecycle["flushPendingSync"];
  cancelPendingSync: Lifecycle["cancelPendingSync"];
  handleCloseTab: Lifecycle["handleCloseTab"];
  toast: Toast;
}

interface ViewState {
  rich: { from: number; to: number } | null;
  richScroller: HTMLElement | null;
  richTop: number;
  md: { anchor: number; head: number } | null;
  mdTop: number;
}

/** The nearest ancestor that actually scrolls. */
function scrollerOf(el: Element | null | undefined): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

/**
 * Live sync between tabs: what THIS tab does when another tab writes to the
 * library it shares (the messages and the pure decisions are store/persistence/tab-sync.ts).
 *
 * - Every message refreshes the library listing and, when it changed, the
 *   folder tree — the Files tab, Cards and the map read those; the link index
 *   follows the listing through its own diff.
 * - A document that is not open here needs nothing more: opening it reads it
 *   fresh, and a draft parked for it keeps its own base, so the save guard
 *   still refuses it.
 * - The OPEN document, clean: reloaded through the hydration ritual, caret and
 *   scroll kept as well as they can be, with a quiet toast. Never while a
 *   composition or projection is in flight, never mid-switch.
 * - The open document with UNSAVED work: the terminal "conflict" now, not at
 *   the next save, and a notice with three ways out — Keep mine, Use theirs,
 *   Save mine as a copy. Whichever side is set aside goes to Version history
 *   first; nothing is written without that click.
 * - The open document DELETED elsewhere: kept on screen, not saving (the save
 *   path refuses to resurrect it), with "Keep as a new document" or "Close".
 *
 * Nothing here writes a document on receipt. Every path that hydrates checks,
 * after its last await, that the editor still holds what it held before.
 */
export function useTabSync(params: TabSyncParams) {
  const paramsRef = useRef(params);
  useEffect(() => { paramsRef.current = params; });

  useEffect(() => {
    let alive = true;
    const P = () => paramsRef.current;
    const store = () => useDocumentStore.getState();
    const ui = useTabSyncStore;
    const editor = () => P().tiptapRef.current?.getEditor?.() ?? null;
    const composing = () => !!(P().cmRef.current?.isComposing?.() || P().tiptapRef.current?.isComposing?.());
    const setNotice = (notice: TabNotice | null) => ui.setState({ notice });
    const warn = (e: unknown) => console.warn("[tabSync]", e);

    const viewOf = (): OpenDocState => {
      const s = store();
      return {
        activeDocId: s.activeDocId,
        hydratedDocId: s.hydratedDocId,
        base: s.activeDoc && s.activeDoc.id === s.activeDocId ? s.activeDoc.updated : null,
        saveStatus: s.saveStatus,
        hasDraft: !!s.activeDocId && !!s.getUnsavedEdit(s.activeDocId),
        composing: composing(),
        pendingProjection: P().hasPendingProjection(),
        schemaLocked: !!s.activeDocId && s.isIncompatible(s.activeDocId),
      };
    };

    /** The editor holds content for `id` that differs from its last stored copy. */
    const unsavedHere = (id: string): boolean => {
      const s = store();
      const ed = editor();
      if (!ed || s.hydratedDocId !== id || s.activeDoc?.id !== id) return false;
      const persisted = (s.activeDoc as { _persistedCanonical?: unknown })._persistedCanonical ?? s.activeDoc.canonical;
      return JSON.stringify(ed.getJSON()) !== JSON.stringify(persisted);
    };

    // ── Keeping caret and scroll across a reload ──────────────────────────────
    const captureView = (): ViewState => {
      const ed = editor();
      const cm = P().cmRef.current?.getView?.() ?? null;
      const richScroller = ed ? scrollerOf(ed.view.dom) : null;
      return {
        rich: ed ? { from: ed.state.selection.from, to: ed.state.selection.to } : null,
        richScroller,
        richTop: richScroller?.scrollTop ?? 0,
        md: cm ? { anchor: cm.state.selection.main.anchor, head: cm.state.selection.main.head } : null,
        mdTop: cm?.scrollDOM.scrollTop ?? 0,
      };
    };
    const restoreView = (v: ViewState) => {
      try {
        const ed = editor();
        // Selection-only transactions: neither pane reports them as a change,
        // so nothing is marked dirty. setTextSelection clamps to the new doc.
        if (ed && v.rich) ed.commands.setTextSelection({ from: v.rich.from, to: v.rich.to });
        const cm = P().cmRef.current?.getView?.();
        if (cm && v.md) {
          const len = cm.state.doc.length;
          cm.dispatch({ selection: { anchor: Math.min(v.md.anchor, len), head: Math.min(v.md.head, len) } });
        }
        if (v.richScroller) v.richScroller.scrollTop = v.richTop;
        if (cm) cm.scrollDOM.scrollTop = v.mdTop;
      } catch { /* best effort — the content is what matters */ }
    };

    /**
     * Put `rec` — just read from storage — into the editor as the open
     * document. Synchronous from the caller's last check to the end: no input
     * can land in between. Dropping the hydration mark first makes it a real
     * hydration for everything keyed on one (the heading-rename baseline
     * starts again from the new headings instead of "finding" the other tab's
     * renames here).
     */
    const showStored = (id: string, rec: DocumentRecord) => {
      P().cancelPendingSync();
      const s = store();
      s.markHydrated(null);
      s.adoptStoredRevision(rec);
      // Same document, new content: undo history is kept, as for Revert.
      P().hydrateEditorWithDoc(id, rec.canonical, { keepHistory: true });
    };

    // ── Receiving ─────────────────────────────────────────────────────────────
    let lastQuietToast = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let batchTimer: ReturnType<typeof setTimeout> | null = null;
    let inbox: TabSyncEvent[] = [];
    // One thing at a time: a batch, a retry and a notice action never
    // interleave their reads and hydrations.
    let chain: Promise<void> = Promise.resolve();
    const enqueue = (fn: () => Promise<void>) => {
      chain = chain.then(() => (alive ? fn() : undefined)).catch(warn);
      return chain;
    };

    const retryLater = (id: string, hinted: string, since: number) => {
      if (Date.now() - since > RETRY_FOR_MS) return; // the save guard is still there
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void enqueue(() => (store().activeDocId === id ? changedWhileOpen(id, hinted, since) : Promise.resolve()));
      }, RETRY_MS);
    };

    const enterConflict = (id: string) => {
      if (store().activeDocId !== id) return;
      store().markConflict(id, "changed");
      setNotice({ docId: id, kind: "changed" });
    };

    const changedWhileOpen = async (id: string, hinted: string, since: number) => {
      let decision = decideOpenDocChange(id, hinted, viewOf());
      if (decision === "ignore") return;
      if (decision === "defer") return retryLater(id, hinted, since);
      const gen = P().claimEditorGeneration(false); // observe only: this may not hydrate at all
      let rec: DocumentRecord | null;
      try {
        rec = await store().getStorage().get(id);
      } catch (e) {
        warn(e); // unreadable: act on nothing; the save guard still reads for itself
        return;
      }
      if (!alive || !rec) return; // gone: a "deleted" message says so (or storage is not shared)
      // The message is a hint; storage decides. And only a revision another tab
      // ANNOUNCED counts: this tab's own write, still settling, looks newer too.
      const theirs = isForeignRevision(id, rec.updated, viewOf().base) ? rec.updated : null;
      decision = decideOpenDocChange(id, theirs, viewOf());
      if (decision === "ignore") return;
      // Another path took the editor while we read: look again once it settles.
      // (Belt and braces, and not observable on its own: every path that takes
      // the editor for ANOTHER document moves activeDocId or hydratedDocId,
      // which the decision above already refuses; one that re-hydrates this
      // same document — Revert, a restore — does so after its own await, and
      // its content is the one left in the editor.)
      if (decision === "defer" || !P().isEditorGeneration(gen)) return retryLater(id, hinted, since);
      if (decision === "conflict") return enterConflict(id);
      const view = captureView();
      showStored(id, rec);
      restoreView(view);
      if (Date.now() - lastQuietToast > QUIET_TOAST_MS) {
        lastQuietToast = Date.now();
        P().toast.show(t("editor.updatedFromAnotherTab"), "info");
      }
    };

    const deletedWhileOpen = async (id: string, cleared: boolean) => {
      let rec: DocumentRecord | null;
      try {
        rec = await store().getStorage().get(id);
      } catch (e) {
        warn(e);
        return;
      }
      // Still stored: brought back (an import reusing the id), or this tab's
      // storage is not the one that was changed.
      if (!alive || rec) return;
      const s = store();
      if (s.activeDocId !== id) return;
      markDeletedElsewhere(id);
      // The deleting tab kept what was on DISK; what this tab has not saved
      // exists nowhere else. Not after an erase, though: that is the user
      // clearing this browser, and version history went with it.
      if (!cleared && hasUnsavedWork(s.saveStatus, !!s.getUnsavedEdit(id))) {
        const ed = s.hydratedDocId === id ? editor() : null;
        if (ed) await snapshotStore.record(id, s.activeDoc?.title ?? t("common.untitled"), ed.getJSON(), "pre-delete").catch(warn);
      }
      if (!alive || store().activeDocId !== id) return;
      store().markConflict(id, "deleted");
      setNotice({ docId: id, kind: "deleted" });
    };

    const adoptMetadata = async (id: string) => {
      let rec: DocumentRecord | null;
      try { rec = await store().getStorage().get(id); } catch { return; }
      if (!alive || !rec || store().activeDocId !== id) return;
      store().adoptStoredMetadata(id, rec.metadata ?? {});
    };

    const refreshFolderTree = async (cleared: boolean) => {
      let prefs: Record<string, unknown>;
      try { prefs = await store().getStorage().getPrefs(); } catch { return; }
      if (!alive) return;
      const raw = prefs["folderTree"];
      const tree = raw && typeof raw === "object" ? (raw as { folders?: unknown; docParents?: unknown; docOrder?: unknown }) : null;
      if (!tree && !cleared) return;
      const isMap = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
      const next = {
        folders: Array.isArray(tree?.folders) ? (tree.folders as FolderRecord[]) : [],
        docParents: isMap(tree?.docParents) ? (tree!.docParents as Record<string, string>) : {},
        docOrder: isMap(tree?.docOrder) ? (tree!.docOrder as Record<string, string[]>) : {},
      };
      if (folderStructureSignature(next) === folderStructureSignature(useFolderStore.getState())) return;
      // Which folders THIS tab has expanded stays this tab's business.
      withRemoteApply(() => useFolderStore.setState(next));
    };

    const handleBatch = async (events: TabSyncEvent[]) => {
      const sum = summarizeEvents(events);
      const titles = new Map(store().documents.map((d) => [d.id, d.title]));
      try { await store().refreshLibrary(); } catch (e) { warn(e); }
      if (sum.library) await refreshFolderTree(sum.cleared);
      if (!alive) return;

      if (sum.deleted.size) {
        // Only what is gone from THIS tab's storage too (a host adapter need
        // not be shared).
        const gone = new Set<string>();
        for (const id of sum.deleted) {
          try { if (!(await store().getStorage().get(id))) gone.add(id); } catch { /* unreadable: not known gone */ }
        }
        if (!alive) return;
        // A draft this tab parked for a document deleted elsewhere exists
        // nowhere else: keep it recoverable.
        for (const id of gone) {
          const s = store();
          const draft = id !== s.activeDocId ? s.getUnsavedEdit(id) : undefined;
          if (draft) await snapshotStore.record(id, titles.get(id) ?? t("common.untitled"), draft, "pre-delete").catch(warn);
        }
        useDocumentStore.setState((s) => ({
          openTabs: s.openTabs.filter((tab) => tab.id === s.activeDocId || !gone.has(tab.id)),
        }));
      }

      const open = store().activeDocId;
      if (!open) return;
      if (sum.deleted.has(open) || sum.cleared) return deletedWhileOpen(open, sum.cleared);
      const hint = sum.changed.get(open);
      if (!hint) return;
      if (hint.meta) return adoptMetadata(open);
      return changedWhileOpen(open, hint.updated, Date.now());
    };

    const stop = startTabSync((events) => {
      inbox.push(...events);
      if (batchTimer) return;
      batchTimer = setTimeout(() => {
        batchTimer = null;
        const batch = inbox;
        inbox = [];
        void enqueue(() => handleBatch(batch));
      }, BATCH_MS);
    });

    // ── The notice follows the open document ─────────────────────────────────
    // A conflict found at SAVE time (a message that never came, a reload that
    // adopted a stale draft) gets the same notice; it goes when the document
    // does, or once a write lands or the stored copy is taken.
    const unsubscribe = useDocumentStore.subscribe((s, prev) => {
      const notice = ui.getState().notice;
      if (notice && (notice.docId !== s.activeDocId ||
          ((s.saveStatus === "saved" || s.saveStatus === "ready") && s.saveStatus !== prev.saveStatus))) {
        setNotice(null);
      }
      if (s.saveStatus === "conflict" && s.activeDocId && !ui.getState().notice) {
        setNotice({ docId: s.activeDocId, kind: isDeletedElsewhere(s.activeDocId) ? "deleted" : "changed" });
      }
    });

    // ── The notice's choices ──────────────────────────────────────────────────
    const noticeFor = (kind: TabNotice["kind"]) => {
      const n = ui.getState().notice;
      return n && n.kind === kind && n.docId === store().activeDocId ? n.docId : null;
    };

    /** Keep mine: theirs to Version history, then an explicit, consented write. */
    const keepMine = async () => {
      const id = noticeFor("changed");
      const ed = editor();
      if (!id || !ed || store().hydratedDocId !== id || useUIStore.getState().readOnly) return;
      const gen = P().claimEditorGeneration(false); // writes; takes nothing from the editor
      const owns = () => alive && P().isEditorGeneration(gen) && store().activeDocId === id && store().hydratedDocId === id;
      P().flushPendingSync(); // the markdown pane's last keystrokes are part of "mine"
      const theirs = await store().getStorage().get(id);
      if (!owns()) return;
      if (!theirs) return deletedWhileOpen(id, false);
      try {
        await snapshotStore.record(id, theirs.title, theirs.canonical, "tab-conflict");
      } catch (e) {
        warn(e);
        P().toast.show(t("editor.tabHistoryFailed"), "error");
        return;
      }
      if (!owns()) return;
      store().consentToRevision(id, theirs.updated);
      setNotice(null);
      let committed = false;
      try {
        committed = await store().saveActiveDoc(ed);
      } catch (e) {
        // A newer write landed in the meantime: refused again, the conflict and
        // its notice are back, and nothing was overwritten.
        warn(e);
      }
      if (committed) P().toast.show(t("editor.tabKeptMine"), "success");
      else {
        const { message, type } = describeUncommittedSave(store());
        P().toast.show(message, type);
      }
    };

    /** Use theirs: mine to Version history, then theirs into the editor. */
    const useTheirs = async () => {
      const id = noticeFor("changed");
      if (!id) return;
      const gen = P().claimEditorGeneration(true);
      const owns = () => alive && P().isEditorGeneration(gen) && store().activeDocId === id;
      for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
        P().endCompositions();
        P().flushPendingSync();
        const held = store().hydratedDocId === id ? editor() : null;
        const mine = held ? held.getJSON() : null;
        const theirs = await store().getStorage().get(id);
        if (!owns()) return;
        if (!theirs) return deletedWhileOpen(id, false);
        if (mine) {
          try {
            await snapshotStore.record(id, store().activeDoc?.title ?? theirs.title, mine, "tab-conflict");
          } catch (e) {
            warn(e);
            P().toast.show(t("editor.tabHistoryFailed"), "error");
            return;
          }
          if (!owns()) return;
        }
        // Typed while that was being kept? Keep that too before replacing it.
        const now = store().hydratedDocId === id ? editor()?.getJSON() : null;
        if ((mine && JSON.stringify(now) !== JSON.stringify(mine)) || composing()) continue;
        showStored(id, theirs);
        setNotice(null);
        P().toast.show(t("editor.tabUsedTheirs"), "success");
        return;
      }
      P().toast.show(t("editor.tabStillTyping"), "warning");
    };

    /** Save mine as a copy: a new document with this tab's content, then theirs here. */
    const saveCopy = async () => {
      const id = noticeFor("changed");
      if (!id || store().hydratedDocId !== id || !editor()) return;
      const gen = P().claimEditorGeneration(true);
      const owns = () => alive && P().isEditorGeneration(gen) && store().activeDocId === id;
      P().endCompositions();
      P().flushPendingSync();
      let mine = editor()!.getJSON();
      const active = store().activeDoc;
      const source = active?.id === id ? active : null;
      const title = t("editor.tabCopyTitle", { title: source?.title || t("common.untitled") });
      const copy = createDocument({
        canonical: mine as DocumentRecord["canonical"],
        title,
        userTitle: title,
        titlePinnedByUser: true,
        metadata: { ...(source?.metadata ?? {}) },
        tags: [...(source?.tags ?? [])],
      });
      await store().saveNewDoc(copy);
      // Filed beside the original, so it is found where the original is.
      const parent = useFolderStore.getState().docParents[id];
      if (parent) useFolderStore.getState().moveDoc(copy.id, parent);
      for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
        P().flushPendingSync();
        const theirs = await store().getStorage().get(id);
        if (!owns()) return;
        if (!theirs) return deletedWhileOpen(id, false);
        const now = store().hydratedDocId === id ? editor()?.getJSON() : null;
        if (now && JSON.stringify(now) !== JSON.stringify(mine)) {
          // Typed while the copy was being written: the copy takes that too.
          mine = now;
          await store().patchDocById(copy.id, { canonical: now as DocumentRecord["canonical"] });
          if (!owns()) return;
          continue;
        }
        if (composing()) { P().endCompositions(); continue; }
        showStored(id, theirs);
        setNotice(null);
        P().toast.show(t("editor.tabSavedCopy", { title }), "success");
        return;
      }
      P().toast.show(t("editor.tabStillTyping"), "warning");
    };

    /** Deleted elsewhere → keep it under a NEW id (the old one stays deleted). */
    const keepAsNew = async () => {
      const id = noticeFor("deleted");
      if (!id) return;
      const gen = P().claimEditorGeneration(true);
      P().endCompositions();
      P().flushPendingSync();
      const s = store();
      const ed = editor();
      const held = s.hydratedDocId === id && ed ? ed : null;
      const old = s.activeDoc?.id === id ? s.activeDoc : null;
      const content = (held ? held.getJSON() : old?.canonical) as DocumentRecord["canonical"] | undefined;
      const fresh = createDocument({
        canonical: content,
        title: old?.title,
        userTitle: old?.userTitle ?? null,
        titlePinnedByUser: old?.titlePinnedByUser,
        metadata: { ...(old?.metadata ?? {}) },
        tags: [...(old?.tags ?? [])],
      });
      // The old id is finished: nothing saves to it again. Clean the status
      // first, so no autosave arms for it while the new document is written.
      s.clearUnsavedEdit(id);
      useDocumentStore.setState({ saveStatus: "ready", saveError: null });
      setNotice(null);
      try {
        // With the editor, finalizeDoc takes its content, activates the new id
        // and marks it hydrated — the editor already shows exactly that.
        await store().finalizeDoc(fresh, held, false);
      } catch (e) {
        warn(e);
        P().toast.show(t("editor.newDocSessionOnly", { title: fresh.title }), "error");
      }
      historyCache.drop(id);
      useDocumentStore.setState((st) => ({ openTabs: st.openTabs.filter((tab) => tab.id !== id) }));
      if (!held && content && P().isEditorGeneration(gen) && store().activeDocId === fresh.id) {
        P().hydrateEditorWithDoc(fresh.id, content);
      }
      P().toast.show(t("editor.tabKeptAsNew"), "success");
    };

    /** Deleted elsewhere → close it, its unsaved text kept in Version history. */
    const closeDeleted = async () => {
      const id = noticeFor("deleted");
      if (!id) return;
      if (!snapshotStore.isEnabled()) {
        // Nothing would keep unsaved text: the ordinary close asks first.
        // Not awaited — the queue must not wait on a dialog the user may
        // leave open while other tabs keep writing.
        void P().handleCloseTab(id);
        return;
      }
      P().endCompositions();
      P().flushPendingSync();
      const kept = unsavedHere(id);
      if (kept) {
        try {
          await snapshotStore.record(id, store().activeDoc?.title ?? t("common.untitled"), editor()!.getJSON(), "pre-delete");
        } catch (e) {
          warn(e);
          P().toast.show(t("editor.tabHistoryFailed"), "error");
          return;
        }
      }
      if (!alive || store().activeDocId !== id) return;
      // Everything unsaved is in Version history now: close without asking.
      store().clearUnsavedEdit(id);
      useDocumentStore.setState({ saveStatus: "ready", saveError: null });
      setNotice(null);
      await P().handleCloseTab(id);
      if (kept) P().toast.show(t("editor.tabClosedDeleted"), "info");
    };

    const run = (fn: () => Promise<void>) => async () => {
      if (ui.getState().busy) return;
      ui.setState({ busy: true });
      try {
        await enqueue(async () => {
          try {
            await fn();
          } catch (e) {
            warn(e);
            P().toast.show(t("editor.tabActionFailed"), "error");
          }
        });
      } finally {
        ui.setState({ busy: false });
      }
    };
    ui.setState({
      actions: {
        keepMine: run(keepMine),
        useTheirs: run(useTheirs),
        saveCopy: run(saveCopy),
        keepAsNew: run(keepAsNew),
        close: run(closeDeleted),
      },
    });

    return () => {
      alive = false;
      stop();
      unsubscribe();
      if (retryTimer) clearTimeout(retryTimer);
      if (batchTimer) clearTimeout(batchTimer);
      ui.setState({ actions: null, notice: null, busy: false });
    };
  }, []);
}
