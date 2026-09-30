import { type MutableRefObject, useCallback } from "react";
import { buildContextPrompt } from "../integration/prompt-builder";
import { extractText } from "../store/document";
import { useDocumentStore } from "../store/documentStore";
import { useUIStore } from "../store/uiStore";
import { t } from "../i18n";
import { inlineAssetRefsInText } from "../store/assets";
import type { CmRef, Confirm, DocStore, Engine, Lifecycle, LinkIndexApi, PromptText, SyncEngine, TiptapRef, Toast, UIStore } from "./types";
import {
  type ExportDocs,
  exportActiveDocAsDocx, exportActiveDocAsFile, exportActiveDocAsPdf, exportAllDocuments, exportFullBackup,
} from "./useExportActions";
import { collectImportItems, type useImportPipeline } from "./useImportPipeline";

interface EditorActionsParams {
  cmRef: CmRef;
  tiptapRef: TiptapRef;
  activeDoc: DocStore["activeDoc"];
  engine: Engine;
  syncMode: UIStore["syncMode"];
  linkIndex: LinkIndexApi["linkIndex"];
  getCanonical: SyncEngine["getCanonical"];
  resetHashes: SyncEngine["resetHashes"];
  setDirty: DocStore["setDirty"];
  createDoc: DocStore["createDoc"];
  importItems: ReturnType<typeof useImportPipeline>["importItems"];
  handleSwitchDoc: Lifecycle["handleSwitchDoc"];
  handleGraphExport: LinkIndexApi["handleGraphExport"];
  /** The library ZIP exporter (useExportActions points it at handleExportDocs). */
  exportDocsRef: MutableRefObject<ExportDocs>;
  /** Opens the URL importer. */
  setShowUrlImport: (open: boolean) => void;
  toast: Toast;
  confirm: Confirm;
  promptText: PromptText;
}

/**
 * The menu bar's action dispatcher, `handleAction(type, data?)`: copy the
 * document as MD / HTML / JSON, Clear document (the ONE sanctioned blank save,
 * via allowBlankSaveOnce), import from files or a URL, the File-menu exports,
 * and Copy as Prompt. Also the two handlers built on it: a file dropped on the
 * editor or the library imports, and "Back up now" runs the File-menu backup.
 */
export function useEditorActions({
  cmRef, tiptapRef, activeDoc, engine, syncMode, linkIndex,
  getCanonical, resetHashes, setDirty, createDoc, importItems, handleSwitchDoc, handleGraphExport,
  exportDocsRef, setShowUrlImport, toast, confirm, promptText,
}: EditorActionsParams) {
  const handleAction = useCallback(async (type: string, data?: any) => {
    if (type === "md" || type === "html" || type === "json") {
      const content = type === "md" ? cmRef.current?.getValue() : type === "html" ? tiptapRef.current?.getHTML() : JSON.stringify(getCanonical(), null, 2);
      // Markdown and HTML are copied for ANOTHER application, which cannot
      // resolve an asset reference: they carry the image data (A086). The JSON
      // is the canonical itself, references and all.
      const text = type === "json" ? content || "" : (await inlineAssetRefsInText(content || "")).text;
      navigator.clipboard.writeText(text).then(() => toast.show(t("editor.formatCopied", { format: type.toUpperCase() }), "success"));
      return;
    }
    if (type === "clear") {
      if (useUIStore.getState().readOnly) return; // read-only: don't wipe the doc
      const ok = await confirm({ title: t("editor.clearDocumentTitle"), description: t("editor.clearDocumentDescription"), confirmLabel: t("common.clear"), destructive: true });
      if (!ok) return;
      cmRef.current?.setValue("");
      tiptapRef.current?.setHTML("");
      // Both set calls above are update-suppressed (no onChange), so without
      // this the clear was never marked dirty or persisted — reloading brought
      // the "cleared" content back. Reset hashes too, or retyping identical
      // content would hash-match stale state and skip syncing.
      resetHashes();
      // This is an EXPLICIT clear, so permit the next save to persist the blank
      // over the stored content — bypassing the data-loss backstop that refuses
      // an accidental/stale blank overwrite.
      useDocumentStore.getState().allowBlankSaveOnce();
      setDirty();
      toast.show(t("editor.contentCleared"), "info");
      return;
    }
    if (type === "export-graph") { handleGraphExport(); return; }
    if (type === "import-url") { setShowUrlImport(true); return; }
    if (type === "export-all-zip") {
      exportAllDocuments(exportDocsRef);
      return;
    }
    if (type === "export-backup-zip") {
      exportFullBackup(exportDocsRef);
      return;
    }
    if (type === "export-pdf" && activeDoc) {
      await exportActiveDocAsPdf(activeDoc, { cmRef, tiptapRef, getCanonical, engine, syncMode, toast });
      return;
    }
    if (type === "prompt" && activeDoc) {
      try {
        const storage = useDocumentStore.getState().getStorage();
        // An unreadable linked document is left out of the prompt, not fatal to it.
        const docStoreGetter = { get: async (id: string) => (storage ? await storage.get(id).catch(() => null) : null) };
        const promptText = await buildContextPrompt(activeDoc, docStoreGetter, linkIndex, {
          format: "markdown",
          mdConverter: (d) => d.markdownCache ?? (engine?.htmlToMd && d.htmlCache ? engine.htmlToMd(d.htmlCache) : extractText(d.canonical)),
          includeBacklinks: true,
          maxDocs: 20,
        });
        await navigator.clipboard.writeText(promptText);
        toast.show(t("editor.promptCopied"), "success");
      } catch (e) {
        toast.show(t("editor.promptBuildFailed"), "error");
      }
      return;
    }
    if ((type === "export-md" || type === "export-html" || type === "export-json") && activeDoc) {
      await exportActiveDocAsFile(type, activeDoc, { cmRef, tiptapRef, getCanonical, engine, syncMode, toast });
      return;
    }
    if (type === "export-docx" && activeDoc) {
      await exportActiveDocAsDocx(activeDoc, { cmRef, tiptapRef, getCanonical, engine, syncMode, toast });
      return;
    }
    if (type === "import" && data?.length) {
      const files = Array.from(data as FileList | File[]);
      // Expand archives into per-entry items, convert .docx, read the rest as
      // text; files that cannot be taken come back in `skipped`.
      const { items, skipped, assets } = await collectImportItems(files, promptText);

      try {
        const { importedCount, failedCount, firstDocId } = await importItems(items, { assets });
        if (skipped.length > 0) {
          toast.show(t("editor.skippedFiles", { count: skipped.length, files: skipped.join(", ") }), "warning");
        }
        if (failedCount > 0) {
          toast.show(t("editor.filesNotSaved", { count: failedCount }), "error");
        }
        if (firstDocId) {
          // handleSwitchDoc hydrates the editor with the target's canonical —
          // a bare switchToDoc left the LAST imported file's content in the
          // editor while activating the FIRST, corrupting it on next save.
          await handleSwitchDoc(firstDocId);
          if (importedCount > 0) toast.show(t("editor.importedFiles", { count: importedCount }), "success");
        } else if (importedCount === 0 && skipped.length === 0 && failedCount === 0) {
          toast.show(t("editor.noSupportedFiles"), "warning");
        }
      } catch (e) { toast.show(t("editor.importFailed"), "error"); }
      return;
    }
  }, [toast, getCanonical, engine, activeDoc, syncMode, handleGraphExport, linkIndex, createDoc, importItems, handleSwitchDoc, confirm, promptText]);

  // Defined here rather than with the other panel callbacks: it closes over
  // handleAction, which is declared above this point.
  const handleFileDropImport = useCallback((files: FileList | File[]) => {
    handleAction("import", files);
  }, [handleAction]);

  // The storage-durability notices and Settings ▸ Storage & backup run the
  // SAME full backup as File ▸ Export, so it is recorded the same way.
  const handleBackupNow = useCallback(() => {
    void handleAction("export-backup-zip");
  }, [handleAction]);

  return { handleAction, handleFileDropImport, handleBackupNow };
}
