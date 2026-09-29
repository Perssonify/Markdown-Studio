import type { RefObject } from "react";
import type { LinkClickPayload } from "../hooks/useLinkIndex";
import type { IDBStorageConfig, StorageMetrics } from "../store/idb-storage-adapter";
import type { StorageAdapter, StorageQuotaError } from "../store/storage-adapter";

export interface PerssonifyEditorProps {
  _integrationRef?: RefObject<any>;
  _onIntegrationChange?: (payload: any) => void;
  _onIntegrationLinkClick?: (payload: LinkClickPayload) => boolean | void;
  _onIntegrationGraphUpdate?: (graph: any) => void;

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
