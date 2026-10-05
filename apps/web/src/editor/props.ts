import type { JSONContent } from "@tiptap/core";
import type { RefObject } from "react";
import type { LinkClickPayload } from "../hooks/useLinkIndex";
import type { EditorChromeLevel, EditorViewMode } from "../integration/host-bridge";
import type { DocumentRecord, DocumentSummary } from "../store/document";
import type { FidelityReport } from "../store/fidelity";
import type { IDBStorageConfig, StorageMetrics } from "../store/idb-storage-adapter";
import type { GraphEdge, GraphNode } from "../store/link-index";
import type { SharePayload } from "../store/share-link";
import type { StorageAdapter, StorageQuotaError } from "../store/storage-adapter";

/** The document graph the editor exports (wiki links between documents). */
export interface EditorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** A document a host adds or updates: markdown, or canonical PM JSON (an
 *  object or its JSON text), with an optional id and title. */
export interface HostDocumentInput {
  id?: string;
  title?: string;
  markdown?: string;
  canonical?: unknown;
}

/** What `_onIntegrationChange` receives after an edit to the open document. */
export interface IntegrationChange {
  docId: string;
  canonical: JSONContent;
  md: string;
  html: string;
  metadata: Record<string, unknown>;
  fidelity: FidelityReport | null;
}

/**
 * The core editor's own handle, which `useHostApi` fills in through
 * `_integrationRef`. `PerssonifyEditorIntegration` builds the public
 * `EditorHandle` on top of it; nothing else reads it.
 */
export interface InternalEditorHandle {
  getCanonical(): JSONContent | null;
  getMarkdown(): string;
  getHTML(): string;
  getFidelityReport(): FidelityReport | null;
  getGraph(): EditorGraph;
  getDocuments(): DocumentSummary[];
  getActiveDocument(): DocumentRecord | null;
  getDocById(id: string): Promise<DocumentRecord | null>;
  importContent(content: string, format: string): Promise<DocumentRecord | null>;
  /** @deprecated Forwards to addDocuments. */
  setDocuments(docs: unknown[]): Promise<{ ids: string[] }>;
  addDocuments(inputs: HostDocumentInput[]): Promise<{ ids: string[] }>;
  updateDocument(id: string, patch?: Omit<HostDocumentInput, "id">): Promise<{ id: string; updated: boolean }>;
  appendToDocument(id: string, markdown: string): Promise<{ id: string; updated: boolean }>;
  /** @deprecated Stores the schemas where nothing reads them. */
  setFieldSchemas(schemas: unknown): void;
  setMode(mode: EditorViewMode): void;
  setChrome(level: EditorChromeLevel): void;
  openDocument(id: string): Promise<void>;
  exportAs(format: string): Promise<void>;
  clearLocalData(opts?: { preferences?: boolean }): Promise<void>;
}

export interface PerssonifyEditorProps {
  _integrationRef?: RefObject<InternalEditorHandle | null>;
  _onIntegrationChange?: (payload: IntegrationChange) => void;
  _onIntegrationLinkClick?: (payload: LinkClickPayload) => boolean | void;
  _onIntegrationGraphUpdate?: (graph: EditorGraph) => void;

  /**
   * Inject a fully custom StorageAdapter. When provided, the editor will not
   * touch localStorage or IndexedDB directly — all persistence is delegated
   * to this adapter.
   */
  storageAdapter?: StorageAdapter;

  /**
   * Configure the built-in IndexedDB adapter without providing a full adapter.
   * Ignored when storageAdapter is provided.
   */
  storageConfig?: IDBStorageConfig;

  /**
   * Called after every successful save or delete with updated storage metrics.
   * Only fires when the active adapter supports metrics (IndexedDBStorageAdapter).
   */
  onStorageMetricsChange?: (metrics: StorageMetrics) => void;

  /**
   * Called when a save is rejected because the configured storage quota would
   * be exceeded. Use this to show a custom error UI.
   */
  onStorageQuotaExceeded?: (err: StorageQuotaError) => void;

  /**
   * Called on every content change (debounced ~300ms). Use for realtime sync
   * to an external system without waiting for an explicit save.
   */
  onContentChange?: (payload: { docId: string; markdown: string; html: string; canonical: any }) => void;

  /**
   * Called after the user explicitly saves a document (Save button or Ctrl+S),
   * after the IndexedDB write has completed successfully.
   */
  onSave?: (payload: { docId: string; markdown: string; html: string; canonical: any }) => void;

  /**
   * Set the editor view mode on first render. One of "md" | "html" | "split".
   * If the user has a stored preference, that wins; initialMode is only used
   * if no preference has been saved yet (first launch or prefs key absent).
   * Subsequent mode changes by the user are not overridden.
   * Defaults to "split".
   */
  initialMode?: "md" | "html" | "split";

  /**
   * Chrome level for the editor UI. "full" (default) shows the tab bar,
   * formatting toolbar, and status bar. "minimal" keeps a slim title strip + the
   * document surface (no formatting toolbar / status bar / ads / backlinks) for a
   * small embedded panel. "none" shows the document surface only. Runtime
   * switchable via the imperative handle's setChrome().
   */
  chrome?: "full" | "minimal" | "none";

  /**
   * Markdown string used to seed a new document when no stored documents
   * exist. When the storage adapter already has documents this prop is
   * ignored so existing work is never overwritten.
   */
  /** Extra first-run documents, seeded ONLY when storage is empty and only
   *  after `initialDocument` is live in the editor. The standalone app uses
   *  this to ship a small linked set so the relationship map opens on a real
   *  graph instead of one unconnected dot; embedders get exactly the one
   *  `initialDocument` they asked for. */
  starterDocuments?: { markdown: string; folderPath?: string[] }[];
  initialDocument?: {
    /** Document title shown in the tab bar and sidebar. */
    title?: string;
    /** Raw markdown content of the document. */
    content: string;
  };

  /**
   * Standalone-app hooks. When the app provides these, About/Help open as
   * routed interior pages and the graph's open state is URL-controlled. When
   * omitted (library / iframe embed), the editor falls back to its built-in
   * dialogs and internal graph toggle, so embedders are unaffected.
   */
  onAbout?: () => void;
  onHelp?: () => void;
  onStartTour?: () => void;
  /** Controlled graph visibility (paired with onGraphOpenChange). */
  graphOpen?: boolean;
  onGraphOpenChange?: (open: boolean) => void;
  /**
   * Standalone app only: storage-durability notices for the app's own library
   * (backup reminder, wiped-library explanation, moved-domain banner, Safari
   * install tip) plus the boot check that stops a library the browser has
   * emptied from being re-seeded as if new. See store/storage-durability.ts.
   * The "not saving" warning shows without it.
   */
  durabilityNotices?: boolean;

  /**
   * Open the URL importer PRE-FILLED with this source (the standalone app
   * passes it from `?import_url=`). It never fetches on its own: the user
   * reviews the URL and presses Fetch, so a shared link cannot make the
   * visitor's browser hit an attacker-chosen address on load.
   *
   * The parameter was documented in Help and emitted by the share-link builder
   * for a long time while nothing read it — the seed state existed but was
   * never set, so every generated import link silently did nothing.
   */
  initialImportUrl?: string;
  /**
   * Standalone app only: documents decoded from a self-contained share link
   * (`#share=…`, see store/share-link.ts). The editor imports them on boot
   * through the normal import path. Omitted by the library / iframe embed.
   */
  initialShare?: SharePayload;

  /**
   * Open read-only: editing disabled, formatting toolbar hidden, view mode
   * locked. Applied for THIS SESSION only (never the persisting setter), so a
   * host embedding one read-only editor cannot leave the visitor's own saved
   * preference stuck read-only — the same rule `?readonly=` follows.
   *
   * The standalone app and the iframe embed both had this; a library consumer
   * had to import `useUIStore` from the `/store` subpath and poke it by hand.
   */
  readOnly?: boolean;

  /**
   * Size to the parent element (which must have a definite height) instead of
   * the viewport. The standalone app uses this to fit the editor under its
   * brand header — without it the editor is viewport-height and the page
   * scrolls by exactly the header height, drifting the chrome off-screen.
   * Library/iframe embedders keep the default viewport sizing.
   */
  fitParent?: boolean;
}
