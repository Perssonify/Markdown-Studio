import { useCallback, useImperativeHandle } from "react";
import { canonicalToMarkdown } from "../engine/serialize-doc";
import { asCanonicalDoc, htmlToCanonical } from "../store/canonical-ops";
import { externalizeCanonical } from "../store/assets";
import type { DocumentRecord } from "../store/document";
import { clearLocalData, useDocumentStore } from "../store/documentStore";
import { useEditorStore } from "../store/editorStore";
import type { IngestFormat } from "../store/ingest";
import { exportGraph } from "../store/link-index";
import type { HostDocumentInput, PerssonifyEditorProps } from "./props";
import type { CmRef, DocStore, Engine, Lifecycle, LinkIndexApi, SyncEngine, TiptapRef, UIStore } from "./types";
import type { useEditorActions } from "./useEditorActions";
import type { useImportPipeline } from "./useImportPipeline";

type ImportPipeline = ReturnType<typeof useImportPipeline>;

interface HostApiParams {
  /** The integration wrapper's handle ref (an internal prop). */
  _integrationRef?: PerssonifyEditorProps["_integrationRef"];
  _onIntegrationGraphUpdate?: PerssonifyEditorProps["_onIntegrationGraphUpdate"];
  cmRef: CmRef;
  tiptapRef: TiptapRef;
  engine: Engine;
  getCanonical: SyncEngine["getCanonical"];
  setFromHtml: SyncEngine["setFromHtml"];
  fidelityReport: DocStore["fidelityReport"];
  activeDoc: DocStore["activeDoc"];
  createDoc: DocStore["createDoc"];
  switchToDoc: DocStore["switchToDoc"];
  patchDocById: DocStore["patchDocById"];
  setMode: UIStore["setMode"];
  setChrome: (level: "full" | "minimal" | "none") => void;
  fullDocsRef: LinkIndexApi["fullDocsRef"];
  rebuildLinks: LinkIndexApi["rebuildLinks"];
  handleSwitchDoc: Lifecycle["handleSwitchDoc"];
  hydrateEditorWithDoc: Lifecycle["hydrateEditorWithDoc"];
  prepareToLeaveActiveDoc: Lifecycle["prepareToLeaveActiveDoc"];
  activateAndCapture: ImportPipeline["activateAndCapture"];
  isEditorTargeting: ImportPipeline["isEditorTargeting"];
  waitForEditor: ImportPipeline["waitForEditor"];
  handleAction: ReturnType<typeof useEditorActions>["handleAction"];
}

/**
 * The editor's imperative handle: what `PerssonifyEditorIntegration` exposes to
 * a library host and the iframe host bridge drives over postMessage — reads
 * (canonical, markdown, HTML, graph, documents) and writes (import, add,
 * update, append, open, export, clear local data). Every write that ends by
 * pushing content into the editor re-checks ownership AFTER its await
 * (isEditorTargeting) and goes through the hydration ritual.
 */
export function useHostApi({
  _integrationRef, _onIntegrationGraphUpdate,
  cmRef, tiptapRef, engine, getCanonical, setFromHtml,
  fidelityReport, activeDoc, createDoc, switchToDoc, patchDocById,
  setMode, setChrome, fullDocsRef, rebuildLinks,
  handleSwitchDoc, hydrateEditorWithDoc, prepareToLeaveActiveDoc,
  activateAndCapture, isEditorTargeting, waitForEditor, handleAction,
}: HostApiParams) {
  /**
   * Append documents to the store (persisted), non-destructively. Reuses the
   * same two-phase create path as "New document"/file import (activate → mount
   * editor → capture canonical → persist), so markdown docs get real PM-JSON
   * canonical (and their [[wiki-links]] show up in the graph). Idempotent by id.
   *
   * Hoisted out of the imperative handle so the deprecated `setDocuments` can
   * forward to it instead of re-implementing it (badly — its own version called
   * the store's PURE createDoc and threw the results away).
   */
  const addDocumentsImpl = useCallback(async (
    inputs: HostDocumentInput[]
  ): Promise<{ ids: string[] }> => {
    const ids: string[] = [];
    let createdCount = 0;

    // Adding documents ACTIVATES the last one created and overwrites both panes,
    // so — exactly like import — this is a document-leaving path and owes the
    // open document the same goodbye: flush the pending sync, cache the draft,
    // keep the undo stack, save. Without it a host calling addDocuments (or the
    // deprecated setDocuments, which now forwards here) destroyed whatever the
    // user had typed inside the current autosave window.
    await prepareToLeaveActiveDoc();

    for (const input of inputs ?? []) {
      // dedupe against the (synchronous) in-memory summary list
      if (input.id && useDocumentStore.getState().documents.some((d) => d.id === input.id)) {
        ids.push(input.id);
        continue;
      }
      const doc = input.canonical
        ? createDoc(
            typeof input.canonical === "string" ? input.canonical : JSON.stringify(input.canonical),
            "pmjson", "api",
            { mdToHtml: engine?.mdToHtml, id: input.id ?? null }
          )
        : createDoc(input.markdown ?? "", "markdown", "api",
            { mdToHtml: engine?.mdToHtml, id: input.id ?? null });
      if (!doc) continue;
      if (input.title) { doc.title = input.title; (doc as DocumentRecord).userTitle = input.title; }
      await activateAndCapture(doc as DocumentRecord);
      ids.push(doc.id);
      createdCount++;
    }
    // Leave the editor genuinely holding whatever the store says is active. An
    // input with no ingest HTML (a `canonical`/pmjson payload, or empty
    // markdown) takes the no-editor branch, which activates WITHOUT hydrating —
    // and an activeDocId/hydratedDocId split makes `saveActiveDoc` refuse every
    // save for the rest of the session. Same hand-off `importItems` performs.
    {
      const store = useDocumentStore.getState();
      const active = store.activeDocId;
      if (active && ids.includes(active) && store.hydratedDocId !== active) {
        const rec = await store.getDocById(active).catch(() => null);
        if (rec?.canonical) hydrateEditorWithDoc(active, rec.canonical);
      }
    }

    if (createdCount > 0) {
      try { await rebuildLinks(); } catch { /* ignore */ }
      try {
        const idx = useEditorStore.getState().linkIndex;
        const docs = useDocumentStore.getState().documents;
        const merged = fullDocsRef.current.map((d) => ({ ...d, ...docs.find((s) => s.id === d.id) }));
        _onIntegrationGraphUpdate?.(exportGraph(merged as Parameters<typeof exportGraph>[0], idx));
      } catch { /* ignore */ }
    }
    return { ids };
  }, [createDoc, engine, activateAndCapture, rebuildLinks, fullDocsRef,
      _onIntegrationGraphUpdate, prepareToLeaveActiveDoc, hydrateEditorWithDoc]);

  // Rebuild the link index and push a fresh graph to the host after a document
  // mutation (add/update/append), reading live store state so the host sees the
  // new nodes/edges without a stale-render race.
  const emitGraphUpdate = useCallback(async () => {
    try { await rebuildLinks(); } catch { /* ignore */ }
    try {
      const idx = useEditorStore.getState().linkIndex;
      const docs = useDocumentStore.getState().documents;
      const merged = fullDocsRef.current.map((d) => ({ ...d, ...docs.find((s) => s.id === d.id) }));
      _onIntegrationGraphUpdate?.(exportGraph(merged as Parameters<typeof exportGraph>[0], idx));
    } catch { /* ignore */ }
  }, [rebuildLinks, _onIntegrationGraphUpdate, fullDocsRef]);

  // Fallback body-edit path used only when no editor is mounted (empty embed):
  // mount the target doc's editor, replace content from full markdown, capture
  // canonical, and persist. This one path does briefly switch the active doc.
  const captureDocFromMarkdown = useCallback(async (
    id: string,
    markdownFull: string,
    title?: string
  ): Promise<{ id: string; updated: boolean }> => {
    if (useDocumentStore.getState().activeDocId !== id) {
      await switchToDoc(id, tiptapRef.current?.getEditor() ?? null);
    }
    const editor = await waitForEditor(2000);
    if (!editor) return { id, updated: false };
    const html = engine?.mdToHtml ? engine.mdToHtml(markdownFull) : markdownFull;
    setFromHtml(html);
    await new Promise((r) => requestAnimationFrame(r));
    useDocumentStore.getState().markHydrated(id); // editor now holds this doc's content
    const canonical = editor.getJSON();
    await patchDocById(id, {
      canonical,
      ...(title != null ? { title, userTitle: title } : {}),
    });
    return { id, updated: true };
  }, [switchToDoc, waitForEditor, engine, setFromHtml, patchDocById, tiptapRef]);

  // ── Integration imperative API ────────────────────────────────────────────
  useImperativeHandle(_integrationRef, () => ({
    getCanonical: () => getCanonical(),
    getMarkdown: () => cmRef.current?.getValue() || "",
    getHTML: () => tiptapRef.current?.getHTML() || "",
    getFidelityReport: () => fidelityReport,
    getGraph: () => {
      try {
        // Read live state so a host that pulls getGraph() right after a mutation
        // (e.g. addDocuments) never sees a stale render's link index / doc list.
        const idx = useEditorStore.getState().linkIndex;
        const docs = useDocumentStore.getState().documents;
        const merged = fullDocsRef.current.map((d) => ({
          ...d,
          ...docs.find((s) => s.id === d.id),
        }));
        return exportGraph(merged, idx);
      } catch { return { nodes: [], edges: [] }; }
    },
    getDocuments: () => useDocumentStore.getState().documents,
    getActiveDocument: () => activeDoc,
    getDocById: (id: string) => useDocumentStore.getState().getDocById(id),
    // Creates and opens a document from host-supplied content. It used to push
    // the content straight into the live editor — over the open document, with
    // no flush, no draft, no save — and a `pmjson` payload was neither saved
    // nor opened at all. It is a document-LEAVING path like import and
    // addDocuments, and goes through the same two steps they do.
    importContent: async (content: string, format: string) => {
      const doc = createDoc(content, format as IngestFormat, "api", { mdToHtml: engine?.mdToHtml });
      if (!doc) return doc;
      await prepareToLeaveActiveDoc();
      await activateAndCapture(doc as DocumentRecord);
      return doc;
    },
    /**
     * @deprecated Additive alias for {@link addDocuments}; prefer that directly.
     *
     * This did nothing at all. It called the store's PURE `createDoc` — which
     * runs ingest and RETURNS a record without persisting or activating
     * anything — and discarded every result, so a host that called it (over the
     * ref API or the postMessage bridge) got a success reply and an unchanged
     * library. It is now a thin forward to the working path rather than a
     * silent no-op; the old "destructive bulk-replace" wording was never true
     * of any shipped build, so nothing can depend on it and it does NOT delete
     * the user's existing documents.
     */
    setDocuments: async (docs: unknown[]): Promise<{ ids: string[] }> => {
      const inputs = (docs ?? []).map((d): HostDocumentInput => {
        if (typeof d === "string") return { markdown: d };
        const doc = (d ?? {}) as HostDocumentInput;
        return { id: doc.id, title: doc.title, markdown: doc.markdown, canonical: doc.canonical };
      });
      return await addDocumentsImpl(inputs);
    },
    // Append documents to the store (persisted), non-destructively. Reuses the
    // same two-phase create path as "New document"/file import (activate → mount
    // editor → capture canonical → persist), so markdown docs get real PM-JSON
    // canonical (and their [[wiki-links]] show up in the graph). Idempotent by id.
    addDocuments: addDocumentsImpl,
    // Update an existing document by id (may be non-active), persisted. Title-only
    // edits use the churn-free rename path. A body edit (markdown/canonical)
    // converts markdown → PM-JSON via the live editor's real schema so a
    // non-active doc is replaced WITHOUT switching the visible editor; only if no
    // editor is mounted do we fall back to the switch+capture path. Emits
    // onGraphUpdate. Returns { id, updated:false } when the id is unknown (never
    // silently creates).
    updateDocument: async (
      id: string,
      patch: Omit<HostDocumentInput, "id"> = {}
    ): Promise<{ id: string; updated: boolean }> => {
      if (!id) return { id, updated: false };
      const existing = await useDocumentStore.getState().getDocById(id);
      if (!existing) return { id, updated: false };

      const hasBody = patch.markdown != null || patch.canonical != null;
      if (!hasBody) {
        if (patch.title != null) {
          // A title-only update must not persist the store's lagging
          // `activeDoc.canonical`. patchDocById already merges the LIVE editor
          // content for the open document (liveCanonicalFor) — and, unlike a
          // canonical passed from here, it knows a title is not content: when
          // another tab has overtaken the document it renames the stored
          // record without writing this tab's content over that tab's work.
          await patchDocById(id, { title: patch.title, userTitle: patch.title });
          await emitGraphUpdate();
        }
        return { id, updated: true };
      }

      const editor = tiptapRef.current?.getEditor();
      // A host's canonical is taken as the PM JSON it claims to be (the type
      // says so; nothing here checks it — the host is trusted with the API).
      let canonical = (patch.canonical as DocumentRecord["canonical"] | undefined) ?? null;
      if (canonical == null) {
        const html = engine?.mdToHtml ? engine.mdToHtml(patch.markdown ?? "") : (patch.markdown ?? "");
        if (editor?.schema) {
          canonical = htmlToCanonical(html, editor.schema);
        } else {
          // No mounted editor to borrow a schema from (empty embed) — fall back to
          // the switch+capture path (mounts the editor; briefly changes active doc).
          const res = await captureDocFromMarkdown(id, patch.markdown ?? "", patch.title);
          await emitGraphUpdate();
          return res;
        }
      }

      // A host's `data:` images become assets like any other import's (A086).
      canonical = (await externalizeCanonical(canonical)).canonical;
      const patched = await patchDocById(id, {
        canonical,
        ...(patch.title != null ? { title: patch.title, userTitle: patch.title } : {}),
      });
      // Post-await check — a switch during the write must not redirect this
      // content into whatever document the editor now holds. Through the
      // hydration ritual, so host content that does not fit this build's
      // schema is shown read-only instead of loading as an empty document.
      if (patched?.canonical && isEditorTargeting(id)) {
        hydrateEditorWithDoc(id, patched.canonical);
      }
      await emitGraphUpdate();
      return { id, updated: !!patched };
    },
    // Append markdown to the end of an existing document by id (may be non-active),
    // persisted. Churn-free: parses the new markdown into PM-JSON via the live
    // editor's schema and appends to the stored canonical WITHOUT switching docs.
    // Emits onGraphUpdate. Returns { updated:false } when the id is unknown.
    appendToDocument: async (
      id: string,
      markdown: string
    ): Promise<{ id: string; updated: boolean }> => {
      if (!id) return { id, updated: false };
      const existing = await useDocumentStore.getState().getDocById(id);
      if (!existing) return { id, updated: false };

      const editor = tiptapRef.current?.getEditor();
      const html = engine?.mdToHtml ? engine.mdToHtml(markdown ?? "") : (markdown ?? "");
      if (!editor?.schema) {
        // No mounted editor — reconstruct existing markdown + appended and capture.
        const base = engine?.htmlToCleanMd
          ? (canonicalToMarkdown(existing.canonical, engine.htmlToCleanMd) ?? "")
          : "";
        const joined = base ? `${base}\n\n${markdown ?? ""}` : (markdown ?? "");
        const res = await captureDocFromMarkdown(id, joined);
        await emitGraphUpdate();
        return res;
      }
      // The appended part's `data:` images become assets (A086) FIRST: that
      // await must come before the live content is read below, not between
      // the read and the write.
      const added = (await externalizeCanonical(htmlToCanonical(html, editor.schema))).canonical;
      // Append base: when the target is the ACTIVE, hydrated document, merge
      // against the LIVE editor content — the stored canonical can be up to an
      // autosave interval stale, and merging against it would wipe those
      // unsaved edits (and persist the wipe).
      const { activeDocId: curId, hydratedDocId: hydId } = useDocumentStore.getState();
      const isActive = curId === id;
      const base = isActive && hydId === id ? editor.getJSON() : existing.canonical;
      const merged = { type: "doc" as const, content: [...asCanonicalDoc(base).content, ...added.content] };
      const patched = await patchDocById(id, { canonical: merged });
      // Post-await check, for the same reason as updateDocument above.
      if (patched?.canonical && isEditorTargeting(id)) {
        // Same-document content update: keep the user's undo history.
        hydrateEditorWithDoc(id, patched.canonical, { keepHistory: true });
      }
      await emitGraphUpdate();
      return { id, updated: !!patched };
    },
    setFieldSchemas: (schemas: unknown) => {
      (window as Window & { __perssonifyFieldSchemas?: unknown }).__perssonifyFieldSchemas = schemas;
    },
    setMode: (m: "md" | "html" | "split") => setMode(m),
    setChrome: (level: "full" | "minimal" | "none") => setChrome(level),
    // Route through handleSwitchDoc (not the raw store switchToDoc): it also
    // hydrates the editor with the target doc's canonical. A bare store switch
    // left the editor holding the PREVIOUS doc's content, which the next save
    // would have written into the newly-active doc.
    openDocument: (id: string) => handleSwitchDoc(id),
    exportAs: async (format: string) => handleAction?.(`export-${format}`),
    /** Erase everything the editor keeps in this browser (see clearLocalData)
     *  — for a host's logout on a shared device. */
    clearLocalData: (opts?: { preferences?: boolean }) => clearLocalData(opts),
  }), [
    // EVERY value the methods close over. The list used to omit handleAction,
    // addDocumentsImpl, emitGraphUpdate and captureDocFromMarkdown, so a method
    // ran with whatever those were when a LISTED value last changed: a host that
    // re-rendered with a new _onIntegrationGraphUpdate kept being called on the
    // old one (A108). Nothing holds on to the handle's identity — the
    // integration reads `ref.current` at call time — so re-creating it is free.
    getCanonical, cmRef, tiptapRef, fidelityReport, fullDocsRef, activeDoc, createDoc, engine,
    prepareToLeaveActiveDoc, activateAndCapture, addDocumentsImpl, patchDocById, emitGraphUpdate,
    isEditorTargeting, hydrateEditorWithDoc, captureDocFromMarkdown, setMode, setChrome,
    handleSwitchDoc, handleAction,
  ]);

}
