import { useCallback, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { setWikiLinkLibrary } from "../extensions/UnresolvedWikiLinks";
import {
  buildLinkIndex,
  exportGraph,
  getBacklinks,
  getForwardLinks,
  resolveWikiLink,
  updateDocInIndex,
  type LinkIndex,
  type DocRecord,
} from "../store/link-index";
import { useDocumentStore } from "../store/documentStore";
import { useEditorStore } from "../store/editorStore";
import { useUIStore } from "../store/uiStore";
import { isDangerousUrl, isExternalHref } from "../utils/url-safety";

/** Discriminated payload for a link activation inside the rich editor. */
export type LinkClickPayload =
  | { kind: "doc"; targetId: string | null; targetTitle: string; notFound?: boolean }
  | { kind: "external"; href: string; external: boolean };

export interface UseLinkIndexParams {
  tiptapRef: React.RefObject<{ getEditor?: () => { view?: { dom?: HTMLElement } } | null } | null>;
  handleSwitchDoc: (docId: string) => void;
  toast: { show: (msg: string, type?: string) => void };
  editorReady: boolean;
  /**
   * EFFECTIVE graph visibility. In the standalone app this is route-driven
   * (/graph), NOT uiStore.showGraph — keying graph-data population on the
   * store flag alone left the routed graph permanently empty. When omitted,
   * falls back to the internal uiStore flag (library/embed behavior).
   */
  graphVisible?: boolean;
  /** Notified on every link activation. Returning `true` signals the host handled
   *  navigation, suppressing the editor's default behavior. */
  onLinkClick?: ((payload: LinkClickPayload) => boolean | void) | null;
  /** Navigate to a heading anchor. `docId` null means the current document.
   *  Used by heading anchor links ([[Doc#Heading]] / [[#Heading]]). */
  onAnchorNavigate?: (docId: string | null, anchor: string) => void;
}

export interface UseLinkIndexReturn {
  linkIndex: LinkIndex;
  handleGraphExport: () => void;
  fullDocsRef: React.MutableRefObject<DocRecord[]>;
  rebuildLinks: () => Promise<void>;
}

export function useLinkIndex({
  tiptapRef,
  handleSwitchDoc,
  toast,
  editorReady,
  graphVisible,
  onLinkClick,
  onAnchorNavigate,
}: UseLinkIndexParams): UseLinkIndexReturn {
  const documents = useDocumentStore((s) => s.documents);
  const activeDocId = useDocumentStore((s) => s.activeDocId);
  const getStorage = useDocumentStore((s) => s.getStorage);
  const internalShowGraph = useUIStore((s) => s.showGraph);
  const showGraph = graphVisible ?? internalShowGraph;

  // Shallow-select: a bare useEditorStore() re-ran this hook's effects on every
  // store write, including per-keystroke setActiveFormats updates.
  const {
    linkIndex,
    setLinkIndex,
    setActiveBacklinks,
    setActiveForwardLinks,
    setActiveUnresolved,
    setGraphData,
  } = useEditorStore(
    useShallow((s) => ({
      linkIndex: s.linkIndex,
      setLinkIndex: s.setLinkIndex,
      setActiveBacklinks: s.setActiveBacklinks,
      setActiveForwardLinks: s.setActiveForwardLinks,
      setActiveUnresolved: s.setActiveUnresolved,
      setGraphData: s.setGraphData,
    }))
  );

  const fullDocsRef = useRef<DocRecord[]>([]);
  const rebuildTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Per-doc {updated,title} snapshot from the LAST index pass — lets the trigger
  // effect tell WHICH doc changed (content edit) vs. a membership/rename change.
  const prevDocsRef = useRef<Map<string, { updated: number; title: string }>>(new Map());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const pendingRenameRef = useRef(false);

  // FULL rebuild: re-read every doc + rebuild the whole index. Used on first run,
  // membership changes (add/remove), and renames (a title change can re-resolve
  // OTHER docs' [[wiki-links]], which a single-doc update wouldn't catch).
  const rebuildLinks = useCallback(async () => {
    const storage = getStorage();
    if (!storage) return;
    try {
      const summaries = await storage.list();
      const fullDocs: DocRecord[] = [];
      for (const s of summaries as { id: string }[]) {
        const doc = await storage.get(s.id);
        if (doc) fullDocs.push(doc);
      }
      fullDocsRef.current = fullDocs;
      setLinkIndex(buildLinkIndex(fullDocs));
    } catch (e) {
      console.warn("[LinkIndex] Rebuild failed:", e);
    }
  }, [getStorage, setLinkIndex]);

  // INCREMENTAL update: re-scan only the docs that changed and splice them into
  // the existing index (O(changed) storage reads + scans, not O(N)). This is the
  // hot path — every autosave of one doc used to re-read and re-scan the entire
  // library. `updateDocInIndex` mutates the index Maps in place, so we hand
  // subscribers a fresh wrapper object to trigger the derive/graph effects.
  const applyIncremental = useCallback(async (ids: string[]) => {
    const storage = getStorage();
    if (!storage) { rebuildLinks(); return; }
    try {
      // A NEW array each time, never a mutation in place. Consumers are allowed
      // to treat `fullDocsRef.current`'s identity as "has the library changed?"
      // — the library body-search does exactly that to cache an id→doc map — and
      // this is the hot path, taken on every ordinary content edit. Mutating the
      // same object left that cache handing back the PRE-EDIT record: a word you
      // had just typed did not match, and a word you had just deleted still did,
      // until some document was added, deleted or renamed.
      for (const id of ids) {
        const doc = await storage.get(id);
        const next = fullDocsRef.current.filter((d) => d.id !== id);
        if (doc) {
          const i = fullDocsRef.current.findIndex((d) => d.id === id);
          if (i >= 0) next.splice(i, 0, doc);
          else next.push(doc);
        }
        fullDocsRef.current = next;
      }
      let idx = useEditorStore.getState().linkIndex;
      for (const id of ids) {
        const doc = fullDocsRef.current.find((d) => d.id === id);
        if (doc) idx = updateDocInIndex(idx, doc, fullDocsRef.current);
      }
      setLinkIndex({ ...idx });
    } catch (e) {
      console.warn("[LinkIndex] Incremental update failed; full rebuild:", e);
      rebuildLinks();
    }
  }, [getStorage, setLinkIndex, rebuildLinks]);

  // Trigger: diff the documents list against the last pass to classify the
  // change. First run / membership change / rename → full rebuild (immediate for
  // membership so panels populate). Pure content edits → debounced incremental.
  useEffect(() => {
    const cur = new Map(
      documents.map((d) => [d.id, { updated: new Date(d.updated).getTime(), title: d.title }])
    );
    const prev = prevDocsRef.current;
    prevDocsRef.current = cur;

    let membershipChanged = cur.size !== prev.size;
    if (!membershipChanged) {
      for (const id of cur.keys()) if (!prev.has(id)) { membershipChanged = true; break; }
    }
    if (prev.size === 0 || membershipChanged) {
      if (rebuildTimerRef.current) { clearTimeout(rebuildTimerRef.current); rebuildTimerRef.current = null; }
      pendingIdsRef.current.clear();
      pendingRenameRef.current = false;
      rebuildLinks();
      return;
    }

    const changed: string[] = [];
    for (const [id, m] of cur) {
      const p = prev.get(id)!;
      if (p.updated !== m.updated) {
        changed.push(id);
        if (p.title !== m.title) pendingRenameRef.current = true; // rename → full
      }
    }
    changed.forEach((id) => pendingIdsRef.current.add(id));

    // Nothing to flush. NOTE: we check the pending SET, not `changed`, because
    // this effect's cleanup clears the debounce timer on every re-run — so a
    // `documents` identity change with no content diff (changed empty) but with
    // ids still queued from a prior edit would otherwise strand those ids until
    // the next edit. Re-scheduling below whenever the set is non-empty fixes it.
    if (pendingIdsRef.current.size === 0) return;

    if (rebuildTimerRef.current) clearTimeout(rebuildTimerRef.current);
    rebuildTimerRef.current = setTimeout(() => {
      rebuildTimerRef.current = null;
      const ids = [...pendingIdsRef.current];
      const renamed = pendingRenameRef.current;
      pendingIdsRef.current.clear();
      pendingRenameRef.current = false;
      if (renamed) rebuildLinks();
      else applyIncremental(ids);
    }, 600);

    return () => {
      if (rebuildTimerRef.current) { clearTimeout(rebuildTimerRef.current); rebuildTimerRef.current = null; }
    };
  }, [documents, rebuildLinks, applyIncremental]);

  // Derive and push active doc link data into editorStore
  useEffect(() => {
    const backlinks = activeDocId ? getBacklinks(linkIndex, activeDocId, fullDocsRef.current) : [];
    const forwardLinks = activeDocId ? getForwardLinks(linkIndex, activeDocId, fullDocsRef.current) : [];
    const unresolved = activeDocId ? (linkIndex.unresolved.get(activeDocId) ?? []) : [];
    setActiveBacklinks(backlinks);
    setActiveForwardLinks(forwardLinks);
    setActiveUnresolved(unresolved);
  }, [linkIndex, activeDocId, setActiveBacklinks, setActiveForwardLinks, setActiveUnresolved]);

  /**
   * F3 / A058. Mark unresolved wiki links in the rendered document.
   *
   * A `[[link]]` whose target does not exist rendered EXACTLY like one that
   * works, so the only way to discover a broken link was to click it. The
   * marking itself is a ProseMirror decoration (extensions/UnresolvedWikiLinks
   * — see there for why writing `data-unresolved` into PM's DOM never worked);
   * this hook only hands it the library to resolve against, every time the
   * index — and so `fullDocsRef` — changes. Not in the mark, deliberately: the
   * answer depends on OTHER documents existing, and baking it into the stored
   * mark would make every rename dirty every document that points at it.
   *
   * Nothing is marked until the library has actually loaded: an empty list
   * would flash every link as broken on a cold start.
   */
  useEffect(() => {
    const docs = fullDocsRef.current;
    const editor = tiptapRef.current?.getEditor?.() as Parameters<typeof setWikiLinkLibrary>[1] | undefined;
    setWikiLinkLibrary(docs.length ? docs : null, editor ?? null);
  }, [linkIndex, tiptapRef]);

  // Push graph data into editorStore when showGraph changes
  useEffect(() => {
    if (showGraph) {
      const data = exportGraph(
        fullDocsRef.current.map((d) => ({
          ...d,
          ...documents.find((s) => s.id === d.id),
        })) as DocRecord[],
        linkIndex
      );
      setGraphData(data);
    } else {
      setGraphData(null);
    }
  }, [showGraph, linkIndex, documents, setGraphData]);

  const handleGraphExport = useCallback(() => {
    const data = exportGraph(
      fullDocsRef.current.map((d) => ({
        ...d,
        ...documents.find((s) => s.id === d.id),
      })) as DocRecord[],
      linkIndex
    );
    navigator.clipboard
      .writeText(JSON.stringify(data, null, 2))
      .then(
        () => toast.show("Graph JSON copied!", "success"),
        () => toast.show("Copy failed", "error")
      );
  }, [documents, linkIndex, toast]);

  // Wiki-link / link click handling for the rich pane.
  //
  // DELEGATED on `document` and resolved at EVENT time — never bound to the
  // editor's DOM. It used to be attached to `editor.view.dom` in an effect with
  // no dependency on the editor instance, so once the editor remounted
  // (closing the last document, then opening another) the listener stayed on
  // the destroyed editor's element and every wiki and external link did
  // nothing. Same pattern as useKeyboardShortcuts: the scope check runs per
  // event against whatever editor exists now.
  useEffect(() => {
    const handler = (e: Event) => {
      const el = tiptapRef.current?.getEditor?.()?.view?.dom;
      const target = e.target as HTMLElement | null;
      if (!el || !target || !el.contains(target)) return;
      const anchor = target.closest("a");
      if (!anchor || !el.contains(anchor)) return;

      // 1) Wiki links ([[Title]]) and heading anchors ([[Doc#Heading]],
      //    [[#Heading]]) → switch documents and/or scroll to a heading.
      const linkTarget = anchor.getAttribute("data-doc-link");
      const anchorName = anchor.getAttribute("data-anchor");
      if (linkTarget !== null && (linkTarget || anchorName)) {
        e.preventDefault();
        e.stopPropagation();

        // Same-document anchor ([[#Heading]]): no target, just scroll.
        if (!linkTarget && anchorName) {
          onAnchorNavigate?.(null, anchorName);
          return;
        }

        // THE resolver — the one the graph, backlinks and broken-link marking
        // use — so a link never goes somewhere other than where the map says.
        const resolved = resolveWikiLink(linkTarget, anchorName, fullDocsRef.current);
        const targetDoc = resolved ? fullDocsRef.current.find((d) => d.id === resolved.id) : undefined;
        if (resolved && targetDoc) {
          const handled = onLinkClick?.({ kind: "doc", targetId: targetDoc.id, targetTitle: targetDoc.title ?? "" });
          if (handled !== true) {
            // A heading anchor scrolls after (and across) the switch; a plain
            // doc link — or a title that itself contains "#" — just switches.
            if (resolved.anchor) onAnchorNavigate?.(targetDoc.id, resolved.anchor);
            else handleSwitchDoc(targetDoc.id);
          }
        } else {
          const handled = onLinkClick?.({ kind: "doc", targetId: null, targetTitle: linkTarget, notFound: true });
          if (handled !== true) toast.show(`Document not found: "${linkTarget}"`, "info");
        }
        return;
      }

      // 2) Regular links: external (http/https/mailto/tel) open in a new tab by
      //    default; custom-scheme / relative links are treated as deep links and
      //    left to the host. The host can intercept EITHER by returning `true`.
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      e.preventDefault();
      e.stopPropagation();
      const isExternal = isExternalHref(href);
      const handled = onLinkClick?.({ kind: "external", href, external: isExternal });
      if (handled === true) return; // host performed navigation
      if (isExternal && !isDangerousUrl(href)) {
        window.open(href, "_blank", "noopener,noreferrer");
      }
      // Deep links (custom scheme / relative path) have no safe default action —
      // the host is expected to handle them via onLinkClick.
    };

    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [handleSwitchDoc, toast, editorReady, tiptapRef, onLinkClick, onAnchorNavigate]);

  return { linkIndex, handleGraphExport, fullDocsRef, rebuildLinks };
}
