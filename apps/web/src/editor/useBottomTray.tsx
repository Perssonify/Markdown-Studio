import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link as LinkIcon, TerminalSquare } from "lucide-react";
import type { ConsoleContext } from "../store/diagnostics/console-commands";
import { extractHeadings } from "../store/documents/doc-outline";
import { useDocumentStore } from "../store/documents/documentStore";
import { useEditorStore } from "../store/editor/editorStore";
import { exportGraph, getBacklinks, getForwardLinks } from "../store/links/link-index";
import { BacklinksPanel } from "../ui/links/backlinksPanel";
import { ConsolePanel } from "../ui/diagnostics/consolePanel";
import { trayFits } from "../ui/chrome/bottomTray/tray-fit";
import type { EditorStore, LinkIndexApi, SyncEngine, Toast } from "./types";
import { t, useT } from "../i18n";

/**
 * The expandable bottom tray: whether it is open, which tab it shows, and the
 * two toggles (the status bar's chevron and its links chip). Both toggles
 * refuse to OPEN the tray when the region it shares with the editor is too
 * short to hold both; closing is never refused. `trayRegionRef` must be on
 * that region — it is what the refusal measures.
 */
export function useBottomTray({ toast }: { toast: Toast }) {
  // Expandable bottom tray (tabbed). Document Links is the first tab; a console /
  // diagnostics tab is planned (docs/backlog.md). Collapsed by default so it costs
  // no vertical space; the status-bar links chip / chevron toggle it.
  const [trayOpen, setTrayOpen] = useState(false);
  const [trayTab, setTrayTab] = useState("links");

  // The tray and the editor share one `overflow-hidden` column, and the
  // editor's floor is not shrinkable — so on a short viewport opening the tray
  // does not squeeze the editor, it clips the tray and the status bar off the
  // bottom of the app. Refuse, and say why, rather than hand over a broken
  // layout. Closing is never blocked.
  const trayRegionRef = useRef<HTMLDivElement>(null);
  const refuseTrayIfCramped = useCallback(() => {
    const h = trayRegionRef.current?.clientHeight ?? 0;
    if (trayFits(h)) return false;
    toast.show(t("status.trayTooShort"), "warning");
    return true;
  }, [toast]);

  const toggleTray = useCallback(() => {
    setTrayOpen((v) => {
      if (v) return false;
      return refuseTrayIfCramped() ? false : true;
    });
  }, [refuseTrayIfCramped]);
  // The tray tab is read inside a stable callback, so it rides a ref rather
  // than the dep array — otherwise every tab change re-created the prop and
  // re-rendered the memoized status bar.
  const trayTabRef = useRef(trayTab);
  useEffect(() => { trayTabRef.current = trayTab; }, [trayTab]);
  const toggleLinksTray = useCallback(() => {
    setTrayTab("links");
    setTrayOpen((v) => {
      const closing = v && trayTabRef.current === "links";
      if (closing) return false;
      return refuseTrayIfCramped() ? false : true;
    });
  }, [refuseTrayIfCramped]);
  const closeTray = useCallback(() => setTrayOpen(false), []);

  return { trayOpen, trayTab, setTrayTab, trayRegionRef, toggleTray, toggleLinksTray, closeTray };
}

interface ConsoleContextParams {
  getCanonical: SyncEngine["getCanonical"];
  /** The link index's loaded documents (the graph export reads them). */
  fullDocsRef: LinkIndexApi["fullDocsRef"];
}

/** The diagnostics Console's read-only view of the editor (see below). */
export function useConsoleContext({ getCanonical, fullDocsRef }: ConsoleContextParams) {
  // Read-only context for the diagnostics console tray tab (admin-gated). Every
  // accessor reads LIVE store/editor state so results reflect the moment a
  // command runs, not a stale render. No write path is exposed (curated,
  // read-only registry — see console-commands.ts).
  const consoleCtx = useMemo<ConsoleContext>(() => ({
    getLifecycleState: () => useDocumentStore.getState().getLifecycleState(),
    getStorageMetrics: () => useDocumentStore.getState().getStorageMetrics(),
    listDocuments: () =>
      useDocumentStore.getState().documents.map((d) => ({
        id: d.id, title: d.title, updated: d.updated, tags: d.tags,
      })),
    getActiveDocId: () => useDocumentStore.getState().activeDocId,
    getActiveOutline: () => extractHeadings(getCanonical()).map((h) => ({ level: h.level, text: h.text })),
    getLinks: (docId) => {
      const idx = useEditorStore.getState().linkIndex;
      const docs = useDocumentStore.getState().documents;
      return {
        backlinks: getBacklinks(idx, docId, docs).map((b) => ({ id: b.docId, title: b.title })),
        forwardLinks: getForwardLinks(idx, docId, docs).map((f) => ({ id: f.docId, title: f.title })),
      };
    },
    getGraph: () => {
      const idx = useEditorStore.getState().linkIndex;
      const docs = useDocumentStore.getState().documents;
      const merged = fullDocsRef.current.map((d) => ({ ...d, ...docs.find((s) => s.id === d.id) }));
      return exportGraph(merged, idx);
    },
  }), [getCanonical]);
  return consoleCtx;
}

interface TrayTabsParams {
  activeBacklinks: EditorStore["activeBacklinks"];
  activeForwardLinks: EditorStore["activeForwardLinks"];
  activeUnresolved: EditorStore["activeUnresolved"];
  navigateToDoc: (id: string) => void;
  /** The admin flag that adds the Console tab. */
  consoleEnabled: boolean;
  consoleCtx: ConsoleContext;
}

/** The tray's tabs: Document Links, plus the Console when the admin flag is on. */
export function useTrayTabs({
  activeBacklinks, activeForwardLinks, activeUnresolved, navigateToDoc, consoleEnabled, consoleCtx,
}: TrayTabsParams) {
  const t = useT();
  // Freshly-built JSX in an array literal: every render handed the memoized
  // tray a brand-new tabs array containing brand-new elements.
  const trayTabs = useMemo(() => [
    {
      id: "links",
      label: t("status.documentLinks"),
      icon: LinkIcon,
      content: (
        <BacklinksPanel
          hideHeader
          backlinks={activeBacklinks}
          forwardLinks={activeForwardLinks}
          unresolved={activeUnresolved}
          onNavigate={navigateToDoc}
        />
      ),
    },
    ...(consoleEnabled
      ? [{ id: "console", label: t("status.consoleTab"), icon: TerminalSquare, content: <ConsolePanel ctx={consoleCtx} /> }]
      : []),
  ], [activeBacklinks, activeForwardLinks, activeUnresolved, navigateToDoc, consoleEnabled, consoleCtx, t]);
  return trayTabs;
}
