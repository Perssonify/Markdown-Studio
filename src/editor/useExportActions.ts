import { type MutableRefObject, useCallback } from "react";
import { canonicalToHtml, canonicalToMarkdown } from "../engine/serialize-doc";
import { resolveDocTitle, type DocumentRecord } from "../store/document";
import { useDocumentStore } from "../store/documentStore";
import { collectFolderExport, useFolderStore } from "../store/folders";
import { downloadBlob, exportAsHtml, exportAsJson, exportAsMarkdown, exportTimestamp, toExportEnvelope } from "../store/import-export";
import { printHtmlDocument } from "../store/print-export";
import { recordFullBackup } from "../store/storage-durability";
import { buildZipAsync, readDocuments } from "../store/zip-builder";
import { t } from "../i18n";
import type { CmRef, DocStore, Engine, SyncEngine, TiptapRef, Toast } from "./types";
import type { useAutosave } from "./useAutosave";

/** The multi-document ZIP exporter, as the editor's `exportDocsRef` holds it. */
export type ExportDocs = (ids: string[], zipName: string, opts?: { canonical?: boolean }) => Promise<number> | void;

interface ExportActionsParams {
  engine: Engine;
  syncMode: string;
  getCanonical: SyncEngine["getCanonical"];
  toast: Toast;
  /** The latest toast, for a message raised after a long export. */
  toastRef: MutableRefObject<Toast>;
  /** Persists the open document before an export reads the library off disk. */
  autosaveRef: ReturnType<typeof useAutosave>["autosaveRef"];
  /** Pointed at handleExportDocs on every render (see exportAllDocuments). */
  exportDocsRef: MutableRefObject<ExportDocs>;
}

/**
 * Exporting from the library: one document in any format (`handleExportDoc`),
 * a folder subtree (`handleExportFolder`), a selection (`handleExportDocs`),
 * each read from STORAGE — preferring the live canonical for the document the
 * editor holds — so any row in the Files panel can be exported without opening
 * it. The helpers below this hook are File-menu exports of the OPEN document
 * and of the whole library, which `handleAction` dispatches to.
 */
export function useExportActions({
  engine, syncMode, getCanonical, toast, toastRef, autosaveRef, exportDocsRef,
}: ExportActionsParams) {
  // Build a ZIP from a set of documents (each with an optional directory path)
  // and trigger a download. Markdown per doc, JSON fallback if canonical→markdown
  // serialization is unavailable. Shared by folder export and multi-select export.
  const exportDocsToZip = useCallback(
    async (
      entries: { docId: string; dirSegments: string[] }[],
      zipName: string,
      opts: { canonical?: boolean } = {}
    ): Promise<number> => {
      const storage = useDocumentStore.getState().getStorage();
      const sanitize = (s: string) =>
        s.replace(/[/\\:*?"<>|]+/g, "_").trim() || "untitled";
      const files: Record<string, string> = {};
      const used = new Set<string>();
      // Persist what is being edited RIGHT NOW before reading the library off
      // disk. Bulk and backup export sourced every document from storage alone,
      // so the open document's last autosave window — up to AUTOSAVE_MS plus the
      // pane-sync debounce — was silently missing from the ZIP. A backup that
      // quietly omits the paragraph you just typed is the worst kind.
      try { await autosaveRef.current(); } catch { /* fall through to stored copy */ }
      // Read everything up front — one transaction on IndexedDB, parallel
      // batches elsewhere — instead of one awaited read per document.
      const { docs: records, unreadable } = await readDocuments(storage, entries.map((e) => e.docId));
      // Serialising a document to markdown is main-thread work as well: yield
      // between slices so a big export does not freeze the page (see buildZipAsync).
      let sliceStart = performance.now();
      for (const { docId, dirSegments } of entries) {
        if (performance.now() - sliceStart > 12) {
          await new Promise((r) => setTimeout(r, 0));
          sliceStart = performance.now();
        }
        const rec = records.get(docId);
        if (!rec) continue;
        // Full backup: always write canonical ProseMirror JSON so styled content
        // (colors/highlights/fonts) round-trips exactly on re-import. Otherwise
        // prefer portable Markdown, falling back to JSON only when serialization fails.
        const md = opts.canonical
          ? null
          : (rec.markdownCache ?? (engine ? canonicalToMarkdown(rec.canonical, engine.htmlToCleanMd) : null));
        // Resolve the authoritative title (honors a pinned rename) for both the
        // filename and the backup envelope, so a renamed doc exports correctly.
        const resolvedTitle = resolveDocTitle(rec, rec.canonical).title;
        const dir = dirSegments.map(sanitize).join("/");
        const base = (dir ? dir + "/" : "") + sanitize(resolvedTitle || "untitled");
        const ext = md != null ? "md" : "json";
        let path = `${base}.${ext}`;
        let i = 1;
        while (used.has(path)) path = `${base} (${i++}).${ext}`;
        used.add(path);
        if (md != null) {
          files[path] = md;
        } else {
          // Full-fidelity backup entry: the `perssonify-document` envelope so
          // title/id/tags/metadata/created/updated all round-trip on re-import
          // (the pmjson ingest reads this envelope), not just the PM content.
          // (Carries schemaVersion, and leaves out the imported raw text and
          // clipboard copies — see toExportEnvelope.)
          files[path] = JSON.stringify(toExportEnvelope(rec, resolvedTitle), null, 2);
        }
      }
      // An unreadable document is reported, never silently left out of what
      // the user believes is a complete backup.
      if (unreadable.length) {
        toastRef.current.show(t("editor.documentsUnreadableNotExported", { count: unreadable.length }), "error");
      }
      const count = Object.keys(files).length;
      if (count === 0) return 0;
      const zip = await buildZipAsync(files);
      // Timestamped filename (YYYYMMDD-HHMMSSmmm) so each export is implicitly
      // version-stamped — a rudimentary portability/backup system.
      const ts = exportTimestamp();
      downloadBlob(
        new Blob([zip as BlobPart], { type: "application/zip" }),
        `${sanitize(zipName)}-${ts}.zip`
      );
      return count;
    },
    [engine]
  );

  // Export a folder subtree as a ZIP of Markdown files (JSON fallback per doc
  // if canonical→markdown serialization fails).
  const handleExportFolder = useCallback(async (folderId: string, opts: { canonical?: boolean } = {}) => {
    const { folders, docParents } = useFolderStore.getState();
    const root = folders.find((f) => f.id === folderId);
    const entries = collectFolderExport(folderId, folders, docParents);
    if (entries.length === 0) { toast.show(t("editor.folderHasNoDocuments"), "warning"); return; }
    try {
      const count = await exportDocsToZip(entries, (root?.name || "folder") + (opts.canonical ? "-backup" : ""), opts);
      toast.show(t("editor.exportedDocuments", { count }), "success");
    } catch { toast.show(t("editor.folderExportFailed"), "error"); }
  }, [exportDocsToZip, toast]);

  // Export ONE library document (active or not) as a single file in the chosen
  // format. Reads the stored record and derives everything from its canonical via
  // serialize-doc helpers, so it never depends on that doc being loaded in the
  // live editor — the reusable path for a right-click "Export" on any list item.
  const handleExportDoc = useCallback(
    async (docId: string, format: "md" | "html" | "docx" | "json") => {
      try {
        const rec = await useDocumentStore.getState().getStorage().get(docId);
        if (!rec) { toast.show(t("editor.documentNotFound"), "error"); return; }
        // Prefer the LIVE canonical when this is the doc currently in the editor
        // (its stored copy can lag by up to one autosave interval).
        const live =
          useDocumentStore.getState().hydratedDocId === docId ? getCanonical() : null;
        const canonical = live ?? rec.canonical;
        // Derive the export title from the SAME canonical used for content, honoring
        // a pinned rename (resolveDocTitle) — otherwise a just-renamed or edited doc
        // exports its content under a stale filename / embedded title.
        const docForExport = {
          ...rec,
          canonical,
          title: resolveDocTitle(rec, canonical).title,
        } as DocumentRecord;
        const getHtml = () => canonicalToHtml(docForExport.canonical);
        if (format === "json") {
          exportAsJson(docForExport);
        } else if (format === "html") {
          exportAsHtml(docForExport, { getHtml });
        } else if (format === "md") {
          exportAsMarkdown(docForExport, {
            getHtml, htmlToMd: engine?.htmlToMd, htmlToCleanMd: engine?.htmlToCleanMd,
            syncMode: syncMode as "clean" | "styled",
          });
        } else {
          const md =
            docForExport.markdownCache ??
            (engine ? canonicalToMarkdown(docForExport.canonical, engine.htmlToCleanMd) : "") ?? "";
          const { exportAsDocx } = await import("../store/docx-export");
          await exportAsDocx(docForExport.title || "Untitled", md);
        }
        toast.show(t("editor.documentExported"), "success");
      } catch { toast.show(t("editor.exportFailed"), "error"); }
    },
    [engine, syncMode, getCanonical, toast]
  );

  // Export an explicit set of document IDs (from sidebar multi-select, or all
  // documents) as a ZIP, preserving each doc's folder path within the archive.
  const handleExportDocs = useCallback(async (docIds: string[], zipName: string, opts: { canonical?: boolean } = {}): Promise<number> => {
    if (docIds.length === 0) { toast.show(t("editor.noDocumentsSelected"), "warning"); return 0; }
    const { folders, docParents } = useFolderStore.getState();
    const byId = new Map(folders.map((f) => [f.id, f]));
    const pathOf = (folderId: string | undefined): string[] => {
      const segs: string[] = [];
      let cur = folderId;
      while (cur) {
        const f = byId.get(cur);
        if (!f) break;
        segs.unshift(f.name);
        cur = f.parentId ?? undefined;
      }
      return segs;
    };
    const entries = docIds.map((docId) => ({
      docId,
      dirSegments: pathOf(docParents[docId]),
    }));
    try {
      const count = await exportDocsToZip(entries, zipName, opts);
      toast.show(t("editor.exportedDocuments", { count }), "success");
      return count;
    } catch { toast.show(t("editor.exportFailed"), "error"); return 0; }
  }, [exportDocsToZip, toast]);
  exportDocsRef.current = handleExportDocs;

  return { handleExportFolder, handleExportDoc, handleExportDocs };
}

/** File ▸ Export ▸ All documents: the whole library as one ZIP. */
export function exportAllDocuments(exportDocsRef: MutableRefObject<ExportDocs>) {
  const ids = useDocumentStore.getState().documents.map((d) => d.id);
  exportDocsRef.current(ids, "all-documents");
}

/** File ▸ Full backup — also what the durability notices' "Back up now" runs. */
export function exportFullBackup(exportDocsRef: MutableRefObject<ExportDocs>) {
  // Full backup: canonical JSON per doc (styled content round-trips exactly),
  // in folders, timestamped. Re-import restores the same library state.
  const ids = useDocumentStore.getState().documents.map((d) => d.id);
  // The backup reminder needs the time of the last RESTORABLE backup, so a
  // non-empty one is recorded (storage-durability, A017).
  void Promise.resolve(exportDocsRef.current(ids, "perssonify-backup", { canonical: true }))
    .then((count) => { if (typeof count === "number" && count > 0) recordFullBackup(); });
}

/** What an export of the OPEN document reads: the live panes and the engine. */
export interface ActiveDocExport {
  cmRef: CmRef;
  tiptapRef: TiptapRef;
  getCanonical: SyncEngine["getCanonical"];
  engine: Engine;
  syncMode: string;
  toast: Toast;
}

type ActiveDoc = NonNullable<DocStore["activeDoc"]>;

/** File ▸ Export ▸ PDF / Print: the rich document through the print dialog. */
export function exportActiveDocAsPdf(activeDoc: ActiveDoc, { tiptapRef, getCanonical }: ActiveDocExport) {
  const html = tiptapRef.current?.getHTML() ?? "";
  // Honor a user rename (pinned userTitle) over the content-derived heading —
  // resolveDocTitle applies the correct precedence (pin → userTitle → derived).
  const title = resolveDocTitle(activeDoc, getCanonical()).title;
  printHtmlDocument(title, html);
}

/** File ▸ Export ▸ Markdown / HTML / JSON for the open document. */
export function exportActiveDocAsFile(
  type: "export-md" | "export-html" | "export-json",
  activeDoc: ActiveDoc,
  { tiptapRef, getCanonical, engine, syncMode, toast }: ActiveDocExport,
) {
  const getHtml = () => tiptapRef.current?.getHTML() ?? "";
  // The live editor's content only when it genuinely holds this document —
  // a document locked read-only (content from a newer build) shows a
  // display copy, and exporting THAT as the JSON would lose what it lacks.
  const canonical = useDocumentStore.getState().hydratedDocId === activeDoc.id
    ? getCanonical()
    : activeDoc.canonical;
  const docForExport = {
    ...activeDoc,
    canonical,
    // Honor a user rename (pinned userTitle) over the content-derived heading.
    title: resolveDocTitle(activeDoc, canonical).title,
  };
  try {
    if (type === "export-md") {
      exportAsMarkdown(docForExport as DocumentRecord, {
        getHtml, htmlToMd: engine?.htmlToMd, htmlToCleanMd: engine?.htmlToCleanMd,
        syncMode: syncMode as "clean" | "styled",
      });
      toast.show(t("editor.markdownExported"), "success");
    } else if (type === "export-html") {
      exportAsHtml(docForExport as DocumentRecord, { getHtml });
      toast.show(t("editor.htmlExported"), "success");
    } else if (type === "export-json") {
      exportAsJson(docForExport as DocumentRecord);
      toast.show(t("editor.jsonExported"), "success");
    }
  } catch (e) { toast.show(t("editor.exportFailed"), "error"); }
}

/** File ▸ Export ▸ Word for the open document (the docx writer is a lazy chunk). */
export async function exportActiveDocAsDocx(
  activeDoc: ActiveDoc,
  { cmRef, tiptapRef, getCanonical, engine, toast }: ActiveDocExport,
) {
  try {
    const canonical = getCanonical();
    const md =
      activeDoc.markdownCache ??
      (engine?.htmlToCleanMd
        ? engine.htmlToCleanMd(tiptapRef.current?.getHTML() ?? "")
        : cmRef.current?.getValue() ?? "");
    const title = resolveDocTitle(activeDoc, canonical).title;
    const { exportAsDocx } = await import("../store/docx-export");
    await exportAsDocx(title, md);
    toast.show(t("editor.wordExported"), "success");
  } catch { toast.show(t("editor.wordExportFailed"), "error"); }
}
