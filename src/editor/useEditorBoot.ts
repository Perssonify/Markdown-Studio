import { type MutableRefObject, useEffect, useRef } from "react";
import { toast as toastSonner } from "sonner";
import { configureLocalStores, useDocumentStore } from "../store/documentStore";
import { useFolderStore } from "../store/folders";
import { historyCache } from "../store/history-cache";
import type { IngestFormat } from "../store/ingest";
import { normalizeMarkdownFeatures } from "../store/settings";
import { noteLibraryAtBoot } from "../store/storage-durability";
import { diagError } from "../utils/diag";
import { t } from "../i18n";
import type { PerssonifyEditorProps } from "./props";
import type { CmRef, DocStore, Engine, Lifecycle, SyncEngine, UIStore } from "./types";
import type { useImportPipeline } from "./useImportPipeline";

type ImportPipeline = ReturnType<typeof useImportPipeline>;

interface PersistPreferencesParams {
  /** True once the boot sequence below has finished. */
  initDoneRef: MutableRefObject<boolean>;
  mode: UIStore["mode"];
  markdownFeatures: UIStore["markdownFeatures"];
  documents: DocStore["documents"];
}

/**
 * Write the user's preferences back to storage as they change — the view mode,
 * the markdown features, the folder tree — and drop folder metadata for
 * documents that no longer exist. None of it runs until boot has finished
 * (`initDoneRef`), by which point the stored preferences have been applied.
 */
export function usePersistPreferences({ initDoneRef, mode, markdownFeatures, documents }: PersistPreferencesParams) {
  // Persist mode preference whenever the user switches modes (after init)
  useEffect(() => {
    if (!initDoneRef.current) return;
    useDocumentStore.getState().getStorage().setPrefs({ editorMode: mode }).catch(() => { });
  }, [mode]);

  // Persist markdown feature/flavor settings whenever they change (after init)
  useEffect(() => {
    if (!initDoneRef.current) return;
    useDocumentStore.getState().getStorage().setPrefs({ markdownFeatures }).catch(() => { });
  }, [markdownFeatures]);

  // Persist the folder tree overlay whenever it changes (after init).
  useEffect(() => {
    return useFolderStore.subscribe((state) => {
      if (!initDoneRef.current) return;
      useDocumentStore
        .getState()
        .getStorage()
        .setPrefs({
          folderTree: {
            folders: state.folders,
            docParents: state.docParents,
            docOrder: state.docOrder,
            expanded: state.expanded,
          },
        })
        .catch(() => { });
    });
  }, []);

  // Drop folder metadata for documents that no longer exist.
  useEffect(() => {
    if (!initDoneRef.current) return;
    useFolderStore.getState().pruneOrphans(new Set(documents.map((d) => d.id)));
  }, [documents]);
}

interface EditorBootParams {
  storageAdapter?: PerssonifyEditorProps["storageAdapter"];
  storageConfig?: PerssonifyEditorProps["storageConfig"];
  initStorage: DocStore["initStorage"];
  engineReady: boolean;
  engine: Engine;
  /** Set true when the sequence finishes; every save path waits for it. */
  initDoneRef: MutableRefObject<boolean>;
  cmRef: CmRef;
  initialize: DocStore["initialize"];
  createDoc: DocStore["createDoc"];
  finalizeDoc: DocStore["finalizeDoc"];
  setFromHtml: SyncEngine["setFromHtml"];
  setInitialSyncMode: UIStore["setInitialSyncMode"];
  setInitialMarkdownFeatures: UIStore["setInitialMarkdownFeatures"];
  setMode: UIStore["setMode"];
  setEditorReady: UIStore["setEditorReady"];
  initialMode: NonNullable<PerssonifyEditorProps["initialMode"]>;
  initialDocument?: PerssonifyEditorProps["initialDocument"];
  starterDocuments?: PerssonifyEditorProps["starterDocuments"];
  durabilityNotices: boolean;
  waitForEditor: ImportPipeline["waitForEditor"];
  importItems: ImportPipeline["importItems"];
  hydrateEditorWithDoc: Lifecycle["hydrateEditorWithDoc"];
  handleSwitchDoc: Lifecycle["handleSwitchDoc"];
  storageMetrics: DocStore["storageMetrics"];
  onStorageMetricsChange?: PerssonifyEditorProps["onStorageMetricsChange"];
}

/**
 * The boot sequence. On the FIRST render, inject the host's storage adapter or
 * config (before anything reads storage). Once the engine is ready, run init:
 * apply the stored preferences and the view mode, load the library, then
 * either hydrate the editor with the restored document or — for an empty
 * library the browser did not wipe — seed `initialDocument` and the starter
 * documents. `initDoneRef` flips to true at the end; until then every save path
 * refuses, because the editor does not yet hold a document. Also forwards
 * storage metrics to the host.
 */
export function useEditorBoot({
  storageAdapter, storageConfig, initStorage,
  engineReady, engine, initDoneRef, cmRef,
  initialize, createDoc, finalizeDoc, setFromHtml,
  setInitialSyncMode, setInitialMarkdownFeatures, setMode, setEditorReady,
  initialMode, initialDocument, starterDocuments, durabilityNotices,
  waitForEditor, importItems, hydrateEditorWithDoc, handleSwitchDoc,
  storageMetrics, onStorageMetricsChange,
}: EditorBootParams) {
  // ── Inject storage adapter before init (runs once, synchronously before engine) ──
  const storageInjectedRef = useRef(false);
  if (!storageInjectedRef.current) {
    storageInjectedRef.current = true;
    if (storageAdapter) {
      initStorage(storageAdapter);
      // With a host's own adapter, storageConfig still decides where the
      // editor's OTHER browser stores go (version history, the crash stash) —
      // or that they are off (see configureLocalStores).
      if (storageConfig) configureLocalStores(storageConfig);
    } else if (storageConfig) {
      initStorage(storageConfig);
    }
  }

  useEffect(() => {
    if (!engineReady || !engine || initDoneRef.current) return;
    (async () => {
      const loadingId = toastSonner.loading(t("editor.initializingEditor"), { duration: Infinity });
      try {
        // Hydrate syncMode from storage prefs before rendering content
        const storage = useDocumentStore.getState().getStorage();
        // Load the per-doc history-cache config (enabled/limits) from prefs.
        void historyCache.init({
          getPrefs: () => storage.getPrefs(),
          setPrefs: (p) => storage.setPrefs(p),
        });
        const prefs = await storage.getPrefs();
        if (typeof prefs["syncMode"] === "string") {
          setInitialSyncMode(prefs["syncMode"]);
        }
        if (prefs["markdownFeatures"]) {
          setInitialMarkdownFeatures(
            normalizeMarkdownFeatures(prefs["markdownFeatures"])
          );
        }
        if (prefs["folderTree"] && typeof prefs["folderTree"] === "object") {
          useFolderStore.getState().setInitialTree(prefs["folderTree"] as any);
        }

        // A `?view_mode=` deep link (applied by App.tsx before this async init ran)
        // is authoritative for this session and must win over the persisted /
        // initialMode default — otherwise this prefs-load would clobber it. App.tsx
        // hands it off via sessionStorage because it strips the param from the URL
        // synchronously; consume it one-shot here.
        let urlMode: string | null = null;
        try {
          urlMode = sessionStorage.getItem("pf:session-view-mode");
          if (urlMode) sessionStorage.removeItem("pf:session-view-mode");
        } catch { /* ignore */ }
        if (urlMode === "md" || urlMode === "html" || urlMode === "split") {
          setMode(urlMode);
        } else if (!prefs["editorMode"]) {
          // Apply initialMode prop — only overrides if the user hasn't persisted
          // a mode preference yet (prefs key absent means first launch).
          setMode(initialMode);
        } else if (typeof prefs["editorMode"] === "string") {
          setMode(prefs["editorMode"] as "md" | "html" | "split");
        } else {
          setMode(initialMode);
        }

        const existingDoc = await initialize();
        // A library the BROWSER emptied (eviction, a cleared or damaged
        // database) must not be greeted as a first visit: seeding the starter
        // documents would dress the loss up as a fresh install. Read-only — it
        // only decides whether to seed; the notice explains (A017).
        const libraryWiped =
          durabilityNotices && noteLibraryAtBoot(useDocumentStore.getState().documents.length);

        if (existingDoc) {
          setEditorReady(true);
          const editor = await waitForEditor();
          if (existingDoc.canonical && editor) {
            // The hydration ritual — it also keeps a document from a newer
            // build (content this schema cannot load) read-only instead of
            // loading it as an empty editor that the next save would persist.
            hydrateEditorWithDoc(existingDoc.id, existingDoc.canonical);
          } else if (existingDoc.canonical && !editor) {
            // Editor slow to mount (cold load / slow device). Keep waiting in
            // the background and hydrate when it appears — WITHOUT this, the
            // editor stayed empty while looking "ready", and the next save
            // would have wiped the stored document. Saves stay blocked by the
            // hydratedDocId guard until hydration lands.
            void waitForEditor(60000).then((late) => {
              const s = useDocumentStore.getState();
              if (!late || s.hydratedDocId != null) return;
              const doc = s.activeDoc;
              if (!doc?.canonical) return;
              const editorEmpty = (late.getText?.() ?? "").trim().length === 0;
              if (editorEmpty) hydrateEditorWithDoc(doc.id, doc.canonical);
            });
            if (cmRef.current) {
              const html = existingDoc._ingestHtml || "";
              const md = html ? engine.htmlToMd(html) : "# " + (existingDoc.title || "Untitled") + "\n\n";
              cmRef.current.setValue(md);
            }
          } else if (cmRef.current) {
            const html = existingDoc._ingestHtml || "";
            const md = html ? engine.htmlToMd(html) : "# " + (existingDoc.title || "Untitled") + "\n\n";
            cmRef.current.setValue(md);
            // No stored canonical — PUSH the ingest content into the editor
            // before marking hydrated (setValue alone is update-suppressed, so
            // marking without pushing would let a save persist stale content).
            setFromHtml(html || engine.mdToHtml(md));
            useDocumentStore.getState().markHydrated(existingDoc.id);
          }
          toastSonner.success(t("editor.restored", { title: existingDoc.title }), { id: loadingId, duration: 3000 });
        } else if (initialDocument && !libraryWiped) {
          // No stored documents — seed with the provided initial document.
          const doc = createDoc(initialDocument.content, "markdown", "api", { mdToHtml: engine.mdToHtml });
          if (doc) {
            if (initialDocument.title) {
              // F4. `title` is the NAME TO FALL BACK TO, not a rename. Setting
              // `userTitle` here made seeding masquerade as a user action:
              // `resolveDocTitle` treats a non-placeholder `userTitle` as a pin,
              // so the welcome document was permanently called "Welcome" while
              // its own H1 read "Markdown Studio", and editing that heading
              // renamed nothing — alone among every document in the app. Same
              // principle as `createFolder`'s `startNaming`: a programmatic
              // creation must not leave traces only a user's action should.
              doc.title = initialDocument.title;
            }
            
            // Activate the doc in the store WITHOUT persisting (sets activeDocId)
            // This causes EditorLayout to mount and Tiptap to initialize
            await finalizeDoc(doc as any, null, true);
            
            // Set editor ready so EditorLayout mounts and Tiptap starts initializing
            setEditorReady(true);
            
            // Now wait for Tiptap to be ready with more generous timeout
            await new Promise((r) => setTimeout(r, 100)); // Give UI time to mount
            const editor = await waitForEditor(3000);

            // If we have an editor and HTML content, sync it in and persist
            if (editor && doc._ingestHtml) {
              setFromHtml(doc._ingestHtml);
              // Give Tiptap time to process the HTML
              await new Promise((r) => requestAnimationFrame(r));
              await new Promise((r) => requestAnimationFrame(r));
              // Now finalize with the editor instance to capture canonical and persist
              await finalizeDoc(doc as any, editor, false);
              // Seed the companion documents AFTER the initial doc is live,
              // through the ordinary import path (which converts headlessly
              // against the live schema and never activates mid-loop, A031),
              // then return to the initial document so the user lands where
              // they expect. Best-effort: a failure here must not break startup.
              if (starterDocuments?.length) {
                try {
                  await importItems(
                    starterDocuments.map((d) => ({
                      raw: d.markdown,
                      format: "markdown" as IngestFormat,
                      folderPath: d.folderPath ?? [],
                    }))
                  );
                  await handleSwitchDoc(doc.id);
                } catch (e) {
                  diagError("initEffect.starterDocuments", e);
                }
              }
              toastSonner.success(t("editor.ready"), { id: loadingId, duration: 3000 });
            } else if (cmRef.current && doc._ingestHtml) {
              // Fallback: if editor still not ready, set markdown and persist manually
              const md = engine.htmlToMd(doc._ingestHtml);
              cmRef.current.setValue(md);
              // Persist the doc with whatever canonical we have
              const storage = useDocumentStore.getState().getStorage();
              await storage.save(doc);
              const list = await storage.list();
              useDocumentStore.setState({ documents: list });
              // NOTE: deliberately NOT marking hydrated here — the editor never
              // mounted, so it holds nothing. The first md→html sync (user
              // typing) marks hydration; until then saves stay safely blocked.
              toastSonner.success(t("editor.ready"), { id: loadingId, duration: 3000 });
            } else {
              toastSonner.dismiss(loadingId);
            }
          } else {
            setEditorReady(true);
            toastSonner.dismiss(loadingId);
          }
        } else {
          // No stored documents and no initialDocument — show empty state.
          setEditorReady(true);
          toastSonner.dismiss(loadingId);
        }
        initDoneRef.current = true;
      } catch (e: any) {
        setEditorReady(true); // Ensure the loading screen is dismissed
        // Optionally, store an error state if you want to display an error UI component
        // setInitError(e instanceof Error ? e : new Error(String(e)));
        toastSonner.error(t("editor.failedToInitialize"), { id: loadingId, duration: 4000 });
        diagError("initEffect.CRASHED", e);
      }
    })();
  }, [engineReady, engine]);

  // ── Propagate storage metrics to host 
  useEffect(() => {
    if (storageMetrics && onStorageMetricsChange) {
      onStorageMetricsChange(storageMetrics);
    }
  }, [storageMetrics, onStorageMetricsChange]);
}
