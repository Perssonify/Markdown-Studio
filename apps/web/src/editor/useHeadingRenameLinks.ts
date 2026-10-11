import { useEffect, useRef, type MutableRefObject } from "react";
import { toast as toastSonner } from "sonner";
import { syntaxTree } from "@codemirror/language";
import { closeHistory } from "@tiptap/pm/history";
import type { Editor } from "@tiptap/core";
import { useDocumentStore } from "../store/documents/documentStore";
import { useUIStore } from "../store/preferences/uiStore";
import { snapshotStore } from "../store/history/snapshot-store";
import { isNewerSchema } from "../store/documents/schema-version";
import { createWikiResolver, type DocRecord } from "../store/links/link-index";
import {
  alignHeadingRenames,
  buildHeadingLinkTransaction,
  countHeadingLinks,
  headingAnchorKey,
  headingsFromDoc,
  rebaselineHeadings,
  renameTable,
  rewriteHeadingLinks,
  type HeadingInfo,
  type HeadingLinkScope,
  type HeadingRename,
} from "../store/links/heading-renames";
import { getLocale, t } from "../i18n";
import type { CmRef, DocStore, Lifecycle, LinkIndexApi, SyncEngine, TiptapRef } from "./types";

/** How long after the caret leaves a renamed heading the offer appears. */
export const HEADING_RENAME_CHECK_MS = 1500;
/** How long the offer stays up; closing it by any means counts as Dismiss. */
const OFFER_MS = 20_000;

interface HeadingRenameLinksParams {
  tiptapRef: TiptapRef;
  cmRef: CmRef;
  fullDocsRef: LinkIndexApi["fullDocsRef"];
  /** Which pane had the caret last (usePaneCommands) — in Split both exist. */
  lastFocusedPaneRef: MutableRefObject<"md" | "html">;
  flushPendingSync: Lifecycle["flushPendingSync"];
  forceSyncHtmlToMd: SyncEngine["forceSyncHtmlToMd"];
  setDirty: DocStore["setDirty"];
  /** The lifecycle's leaving paths report the document they leave through
   *  this ref: they are created before the link index this hook needs. */
  leaveRef: MutableRefObject<((docId: string) => void) | null>;
}

interface CaretHeading {
  /** Which heading block: its start position in the pane that has the caret. */
  key: string;
  text: string;
}

type Composable = { isComposing?: () => boolean; endComposition?: () => void } | null;
/** The part of a lezer syntax node read here. */
interface MdNode { name: string; from: number; to: number; parent: MdNode | null }

const MD_HEADING = /^(?:ATX|Setext)Heading[1-6]$/;

/** The text of a markdown heading node, markers removed. */
function markdownHeadingText(raw: string, setext: boolean): string {
  if (setext) return (raw.split("\n")[0] ?? "").trim();
  return raw.replace(/^\s*#{1,6}\s*/, "").replace(/\s*#*\s*$/, "").trim();
}

/**
 * Renaming a heading keeps the links to it working (backlog #122).
 *
 * The heading texts a document has when it is HYDRATED are its baseline. When
 * the caret LEAVES a heading — never while it is in one: "Old heading" →
 * "Old headi" → "New heading" is typing, not three renames — and, a moment
 * later, a heading's anchor has gone from the document while links elsewhere
 * still point at it, a toast offers to retarget them. Leaving the document
 * (switch, new, close, import…) checks too, and the offer then names the
 * document just left. Nothing is rewritten without that consent.
 *
 * Accepting rewrites the OPEN document as one undoable transaction and every
 * other document through `patchDocById` (its conflict check, a snapshot
 * first); a document that cannot be written safely is skipped and named.
 * Either answer re-baselines, so a rename is offered once.
 *
 * Cost: the caret check is a walk up from the selection. The heading list is
 * read from the live state only after the caret leaves a heading, and the
 * library is scanned — from the link index's in-memory copy, never storage —
 * only when a rename has actually been found.
 */
export function useHeadingRenameLinks({
  tiptapRef, cmRef, fullDocsRef, lastFocusedPaneRef, flushPendingSync, forceSyncHtmlToMd, setDirty, leaveRef,
}: HeadingRenameLinksParams) {
  const baselineRef = useRef<{ docId: string; headings: HeadingInfo[] } | null>(null);
  const caretRef = useRef<CaretHeading | null>(null);
  const checkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Renames an offer on screen is already asking about (subject + old → new).
  const pendingRef = useRef(new Set<string>());
  // The callbacks from the editor, read at event time (they are stable today;
  // a ref keeps the listeners below from depending on that).
  const fnRef = useRef({ flushPendingSync, forceSyncHtmlToMd, setDirty });
  useEffect(() => { fnRef.current = { flushPendingSync, forceSyncHtmlToMd, setDirty }; }, [flushPendingSync, forceSyncHtmlToMd, setDirty]);

  useEffect(() => {
    let alive = true;
    const editor = (): Editor | null => tiptapRef.current?.getEditor?.() ?? null;
    const panes = (): Composable[] => [cmRef.current as Composable, tiptapRef.current as Composable];
    const clearCheck = () => {
      if (checkTimerRef.current) { clearTimeout(checkTimerRef.current); checkTimerRef.current = null; }
    };

    // ── Baseline ──────────────────────────────────────────────────────────
    const takeBaseline = (docId: string | null) => {
      clearCheck();
      caretRef.current = null;
      const ed = editor();
      baselineRef.current = docId && ed ? { docId, headings: headingsFromDoc(ed.state.doc) } : null;
    };
    const rebaseline = (docId: string, renames: HeadingRename[]) => {
      const base = baselineRef.current;
      if (base?.docId === docId) baselineRef.current = { docId, headings: rebaselineHeadings(base.headings, renames) };
    };
    const offerKey = (docId: string, r: HeadingRename) => `${docId}\u0000${headingAnchorKey(r.oldText)}\u0000${headingAnchorKey(r.newText)}`;

    // ── The library, as fresh as memory allows ────────────────────────────
    // The link index's copy of every document, with the live editor's content
    // for the open one (the stored copy lags it by an autosave) and the
    // leaving document's content as it was left.
    const library = (override?: { id: string; canonical: unknown; title?: string }): DocRecord[] => {
      const s = useDocumentStore.getState();
      const live = s.activeDocId && s.hydratedDocId === s.activeDocId ? s.activeDocId : null;
      const ed = live && live !== override?.id ? editor() : null;
      const docs = fullDocsRef.current.map((d) => {
        if (override && d.id === override.id) return { ...d, canonical: override.canonical as DocRecord["canonical"] };
        if (ed && d.id === live) return { ...d, canonical: ed.getJSON() as DocRecord["canonical"] };
        return d;
      });
      // A document the index has not seen yet (created moments ago) can still
      // hold same-document `[[#…]]` links.
      if (override && !docs.some((d) => d.id === override.id)) {
        docs.push({ id: override.id, title: override.title, canonical: override.canonical as DocRecord["canonical"] });
      }
      return docs;
    };
    const scopeFor = (lib: DocRecord[], subjectDocId: string, renames: HeadingRename[]) => {
      const resolve = createWikiResolver(lib);
      const table = renameTable(renames);
      return (sourceDocId: string): HeadingLinkScope => ({ sourceDocId, subjectDocId, resolve, renames: table });
    };
    const titleOf = (id: string, lib?: DocRecord[]) =>
      useDocumentStore.getState().documents.find((d) => d.id === id)?.title
        ?? lib?.find((d) => d.id === id)?.title ?? id;

    /** "“A”, “B” and “C”", in the interface language. */
    const noteList = (titles: string[]) => {
      const quoted = titles.map((title) => t("editor.headingLinksNoteName", { title }));
      try { return new Intl.ListFormat(getLocale(), { type: "conjunction" }).format(quoted); }
      catch { return quoted.join(", "); }
    };

    // ── Rewriting ─────────────────────────────────────────────────────────
    // Never the open document through storage, never a locked one, and never
    // one whose own unsaved draft would later be saved over this write (or
    // turn it into a conflict). Asked before the read AND after the awaits:
    // the user can open the document, or leave it with a draft, in between.
    const writableThroughStorage = (id: string) => {
      const s = useDocumentStore.getState();
      return s.activeDocId !== id && s.schemaLock?.docId !== id && !s.getUnsavedEdit(id);
    };
    /** One stored (not open) document: the links rewritten, 0 when there were
     *  none after all, or null when it could not be written safely — reported,
     *  never forced. */
    const writeStored = async (id: string, scope: HeadingLinkScope): Promise<number | null> => {
      if (!writableThroughStorage(id)) return null;
      const s = useDocumentStore.getState();
      let stored;
      try { stored = await s.getStorage().get(id); } catch { return null; }
      if (!stored?.canonical || isNewerSchema(stored.schemaVersion)) return null;
      const { canonical, count } = rewriteHeadingLinks(stored.canonical, scope);
      if (!count) return 0;
      // patchDocById does not snapshot: keep the copy this replaces in
      // Version history before writing.
      try { await snapshotStore.record(id, stored.title, stored.canonical, "pre-link-update"); } catch { return null; }
      if (!writableThroughStorage(id)) return null;
      try {
        // expectedUpdated: another tab's write since this read is a ConflictError.
        const written = await useDocumentStore.getState().patchDocById(id, { canonical: canonical as typeof stored.canonical, expectedUpdated: stored.updated });
        // Nothing written: the document was deleted meanwhile — no links to count.
        if (!written) return 0;
      } catch {
        return null;
      }
      return count;
    };

    const apply = async (subjectDocId: string, renames: HeadingRename[], subjectCanonical: unknown) => {
      if (useUIStore.getState().readOnly) { toastSonner.info(t("editor.headingLinksReadOnly")); return; }
      // The renamed document as the offer saw it — unless it is open, when
      // the live editor is fresher still (library() reads it).
      const s0 = useDocumentStore.getState();
      const subjectIsLive = s0.activeDocId === subjectDocId && s0.hydratedDocId === subjectDocId;
      const lib = library(subjectIsLive ? undefined : { id: subjectDocId, canonical: subjectCanonical });
      const scope = scopeFor(lib, subjectDocId, renames);
      let updated = 0;
      const skipped: string[] = [];

      // The open document: ONE transaction, so ⌘Z takes it back.
      const s = useDocumentStore.getState();
      const activeId = s.activeDocId;
      if (activeId) {
        const ed = s.hydratedDocId === activeId && s.schemaLock?.docId !== activeId ? editor() : null;
        if (ed?.isEditable) {
          // As the format dispatcher does: a live composition is ended (its
          // text committed) rather than dispatched into…
          if (panes().some((p) => p?.isComposing?.())) panes().forEach((p) => p?.endComposition?.());
          // …and a markdown edit not yet projected is projected first, or it
          // would land afterwards and put the old links back.
          fnRef.current.flushPendingSync();
          const built = buildHeadingLinkTransaction(ed.state, scope(activeId));
          if (built) {
            void snapshotStore.record(activeId, titleOf(activeId, lib), ed.getJSON(), "pre-link-update").catch(() => {});
            ed.view.dispatch(closeHistory(built.tr));
            fnRef.current.forceSyncHtmlToMd();
            fnRef.current.setDirty();
            updated += built.count;
          }
        } else {
          const doc = lib.find((d) => d.id === activeId);
          if (doc && countHeadingLinks(doc.canonical, scope(activeId)).size) skipped.push(titleOf(activeId, lib));
        }
      }

      // Every other document, one at a time, through the store.
      for (const doc of lib) {
        if (doc.id === activeId) continue;
        // Read from storage only what the in-memory copy shows a link in.
        if (!countHeadingLinks(doc.canonical, scope(doc.id)).size) continue;
        const n = await writeStored(doc.id, scope(doc.id));
        if (n === null) skipped.push(titleOf(doc.id, lib));
        else updated += n;
      }

      if (skipped.length) {
        toastSonner.warning(t("editor.headingLinksPartlyUpdated", { count: updated, titles: noteList(skipped) }));
      } else {
        toastSonner.success(t("editor.headingLinksUpdated", { count: updated }));
      }
    };

    // ── Offering ──────────────────────────────────────────────────────────
    const offer = (subjectDocId: string, renames: HeadingRename[], subjectCanonical: unknown, left: boolean) => {
      if (!alive) return;
      const title = titleOf(subjectDocId);
      const lib = library({ id: subjectDocId, canonical: subjectCanonical, title });
      const scope = scopeFor(lib, subjectDocId, renames);
      const byKey = new Map<string, number>();
      const notes = new Set<string>();
      for (const doc of lib) {
        const counts = countHeadingLinks(doc.canonical, scope(doc.id));
        if (!counts.size) continue;
        notes.add(doc.id);
        for (const [k, n] of counts) byKey.set(k, (byKey.get(k) ?? 0) + n);
      }
      const linked = renames.filter((r) => byKey.has(headingAnchorKey(r.oldText)));
      // Nothing points at the others: nothing to ask, and nothing to ask again.
      const unlinked = renames.filter((r) => !linked.includes(r));
      unlinked.forEach((r) => pendingRef.current.delete(offerKey(subjectDocId, r)));
      rebaseline(subjectDocId, unlinked);
      if (!linked.length) return;

      const count = linked.reduce((sum, r) => sum + (byKey.get(headingAnchorKey(r.oldText)) ?? 0), 0);
      const vars = { count, notes: t("editor.headingRenameNotes", { count: notes.size }), title };
      const message = linked.length === 1
        ? t(left ? "editor.headingRenamedOfferIn" : "editor.headingRenamedOffer", { ...vars, heading: linked[0]!.newText })
        : t(left ? "editor.headingsRenamedOfferIn" : "editor.headingsRenamedOffer", vars);
      const keys = linked.map((r) => offerKey(subjectDocId, r));
      keys.forEach((k) => pendingRef.current.add(k));
      let settled = false;
      const settle = (accept: boolean) => {
        if (settled) return;
        settled = true;
        // Either answer is final for these renames (one offer per rename).
        rebaseline(subjectDocId, linked);
        const done = () => keys.forEach((k) => pendingRef.current.delete(k));
        if (!accept) { done(); return; }
        apply(subjectDocId, linked, subjectCanonical)
          .catch((e) => {
            console.warn("[heading-renames] Update failed:", e);
            toastSonner.error(t("editor.headingLinksPartlyUpdated", { count: 0, titles: noteList([title]) }));
          })
          .finally(done);
      };
      toastSonner(message, {
        duration: OFFER_MS,
        action: { label: t("editor.headingLinksUpdate"), onClick: () => settle(true) },
        cancel: { label: t("editor.headingLinksDismiss"), onClick: () => settle(false) },
        onDismiss: () => settle(false),
        onAutoClose: () => settle(false),
      });
    };

    /** Renames of the open document not already being asked about. */
    const findRenames = (docId: string): HeadingRename[] => {
      const base = baselineRef.current;
      const ed = editor();
      if (!base || base.docId !== docId || !ed) return [];
      return alignHeadingRenames(base.headings, headingsFromDoc(ed.state.doc))
        .filter((r) => !pendingRef.current.has(offerKey(docId, r)));
    };

    // ── Where the caret is ────────────────────────────────────────────────
    const caretHeading = (): CaretHeading | null => {
      const mode = useUIStore.getState().mode;
      const pane = mode === "md" ? "md" : mode === "html" ? "html" : lastFocusedPaneRef.current;
      if (pane === "html") {
        const ed = editor();
        if (!ed) return null;
        const { $from } = ed.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name === "heading") return { key: `pm:${$from.before(d)}`, text: node.textContent };
        }
        return null;
      }
      const view = cmRef.current?.getView?.();
      if (!view) return null;
      const head = view.state.selection.main.head;
      const tree = syntaxTree(view.state);
      // Both sides: a caret before the "#" or after the last character is
      // still in the heading.
      for (const side of [-1, 1] as const) {
        for (let n: MdNode | null = tree.resolveInner(head, side); n; n = n.parent) {
          if (MD_HEADING.test(n.name)) {
            return { key: `md:${n.from}`, text: markdownHeadingText(view.state.sliceDoc(n.from, n.to), n.name.startsWith("Setext")) };
          }
        }
      }
      return null;
    };

    // ── The caret-leave check ─────────────────────────────────────────────
    const runCheck = () => {
      checkTimerRef.current = null;
      if (!alive || useUIStore.getState().readOnly) return;
      const s = useDocumentStore.getState();
      const docId = s.activeDocId;
      if (!docId || s.hydratedDocId !== docId) return;
      // A projection deferred by a live composition has not reached the rich
      // pane yet; look again once it has.
      if (panes().some((p) => p?.isComposing?.())) { scheduleCheck(); return; }
      // The heading the caret is in now is still being written.
      const here = caretHeading();
      const hereKey = here ? headingAnchorKey(here.text) : null;
      const renames = findRenames(docId).filter((r) => headingAnchorKey(r.newText) !== hereKey);
      if (!renames.length) return;
      offer(docId, renames, editor()!.getJSON(), false);
    };
    function scheduleCheck() {
      clearCheck();
      checkTimerRef.current = setTimeout(runCheck, HEADING_RENAME_CHECK_MS);
    }

    let evalQueued = false;
    const evaluate = () => {
      evalQueued = false;
      if (!alive || !editor()) return;
      const s = useDocumentStore.getState();
      // A baseline missed at hydration (the editor mounted after it).
      if (s.hydratedDocId && baselineRef.current?.docId !== s.hydratedDocId) takeBaseline(s.hydratedDocId);
      const here = caretHeading();
      const prev = caretRef.current;
      caretRef.current = here;
      if (prev && prev.key !== here?.key) scheduleCheck();
    };
    // Browsers report every caret move as `selectionchange` (typing, arrows,
    // clicks, in both panes). Deferred one task: ProseMirror reads the new
    // DOM selection in its OWN selectionchange listener, which may run after
    // this one.
    const queueEvaluate = () => {
      if (evalQueued) return;
      evalQueued = true;
      setTimeout(evaluate, 0);
    };

    // ── Leaving the document ──────────────────────────────────────────────
    leaveRef.current = (docId: string) => {
      clearCheck();
      caretRef.current = null;
      if (!alive || useUIStore.getState().readOnly) return;
      const s = useDocumentStore.getState();
      if (s.hydratedDocId !== docId) return;
      const renames = findRenames(docId);
      if (!renames.length) return;
      // Claimed now: an import leaves the note twice (the goodbye, then the
      // switch to what it imported), and both run before this offer does.
      renames.forEach((r) => pendingRef.current.add(offerKey(docId, r)));
      // Captured now, while the editor still holds it; offered once the
      // leaving path has moved on (the scan must not delay the switch).
      const canonical = editor()!.getJSON();
      setTimeout(() => offer(docId, renames, canonical, true), 0);
    };

    takeBaseline(useDocumentStore.getState().hydratedDocId);
    const unsubscribe = useDocumentStore.subscribe((s, prev) => {
      if (s.hydratedDocId !== prev.hydratedDocId) takeBaseline(s.hydratedDocId);
    });
    document.addEventListener("selectionchange", queueEvaluate);
    document.addEventListener("keyup", queueEvaluate, true);
    document.addEventListener("pointerup", queueEvaluate, true);
    return () => {
      alive = false;
      clearCheck();
      unsubscribe();
      leaveRef.current = null;
      document.removeEventListener("selectionchange", queueEvaluate);
      document.removeEventListener("keyup", queueEvaluate, true);
      document.removeEventListener("pointerup", queueEvaluate, true);
    };
  }, [tiptapRef, cmRef, fullDocsRef, lastFocusedPaneRef, leaveRef]);
}
