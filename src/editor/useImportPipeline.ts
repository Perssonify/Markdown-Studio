import { useCallback } from "react";
import { headlessSchema } from "../engine/serialize-doc";
import { ArchiveEncryptedError, ArchiveWrongPasswordError, archiveEntriesToItems, extractArchive, isArchiveName, type ArchiveEntry } from "../store/archive";
import type { DocumentRecord } from "../store/document";
import { useDocumentStore } from "../store/documentStore";
import { useFolderStore } from "../store/folders";
import { captureIngestHeadless } from "../store/headless-ingest";
import { getFileContentAndFormat } from "../store/import-export";
import type { IngestFormat } from "../store/ingest";
import type { ImportResource } from "../store/url-import";
import type { DocStore, Engine, Lifecycle, PromptText, TiptapRef, Toast } from "./types";

interface ImportPipelineParams {
  tiptapRef: TiptapRef;
  engine: Engine;
  createDoc: DocStore["createDoc"];
  finalizeDoc: DocStore["finalizeDoc"];
  saveNewDoc: DocStore["saveNewDoc"];
  prepareToLeaveActiveDoc: Lifecycle["prepareToLeaveActiveDoc"];
  hydrateEditorWithDoc: Lifecycle["hydrateEditorWithDoc"];
  handleSwitchDoc: Lifecycle["handleSwitchDoc"];
  toast: Toast;
  /** The URL importer's dialog state — closed once an import lands. */
  setShowUrlImport: (open: boolean) => void;
  setImportUrlSeed: (url: string | null) => void;
}

/**
 * Creating documents from outside the editor: file, archive and URL import
 * (`importItems`, `handleImportUrl`), the activate-and-hydrate step the host
 * bridge and quick capture share (`activateAndCapture`), and the post-await
 * ownership check every write-then-hydrate path relies on
 * (`isEditorTargeting`). Import is a document-LEAVING path: it says goodbye to
 * the open document (prepareToLeaveActiveDoc) before anything else.
 */
export function useImportPipeline({
  tiptapRef, engine, createDoc, finalizeDoc, saveNewDoc,
  prepareToLeaveActiveDoc, hydrateEditorWithDoc, handleSwitchDoc, toast,
  setShowUrlImport, setImportUrlSeed,
}: ImportPipelineParams) {
  const waitForEditor = useCallback((maxMs = 1500): Promise<any> => new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const ed = tiptapRef.current?.getEditor();
      if (ed) return resolve(ed);
      if (Date.now() - start > maxMs) return resolve(null);
      requestAnimationFrame(check);
    };
    check();
  }), []);

  /**
   * Persist and ACTIVATE a freshly created document, then hydrate the editor
   * with it — if, after every await, the store is still on it.
   *
   * The canonical is captured HEADLESSLY (see captureIngestHeadless): this used
   * to borrow the live editor — activate, push the ingest HTML in, yield a
   * frame, read it back — and a document switch landing in that frame either
   * captured the OTHER document's content as this one's or persisted an empty
   * "Untitled". There is no yield between conversion and persistence now.
   * Hydration is checked on `activeDocId` alone: a switch that took the store
   * elsewhere hydrates its own document, and this must not push over it.
   *
   * Used by every path that creates and opens a document outside import:
   * the host bridge's `addDocuments` and `importContent`, and quick capture
   * on the Cards board.
   */
  const activateAndCapture = useCallback(async (doc: DocumentRecord) => {
    captureIngestHeadless(doc, tiptapRef.current?.getEditor?.()?.schema ?? headlessSchema());
    await finalizeDoc(doc, null, false);     // persist + activate (the editor mounts if it was not)
    const editor = await waitForEditor(2000);
    if (editor && useDocumentStore.getState().activeDocId === doc.id) {
      hydrateEditorWithDoc(doc.id, doc.canonical);
    }
  }, [finalizeDoc, waitForEditor, hydrateEditorWithDoc, tiptapRef]);

  /**
   * Is THIS document the one the editor is showing (or switching to)?
   *
   * Must be evaluated AFTER every await, never captured before one. Persisting
   * goes through IndexedDB, which is slow enough that a document switch lands
   * mid-write routinely; a pre-await snapshot then authorises pushing document
   * A's content into an editor that now holds document B, and autosave writes it
   * into B's record. This is the same chokepoint `saveActiveDoc` re-asserts
   * after its own await (see CLAUDE.md).
   *
   * Deliberately checks `activeDocId` ONLY. Also requiring `hydratedDocId` was
   * too strict and swallowed a REPAIR: when a document is active but not yet
   * hydrated, pushing its freshly-written content into the editor and marking it
   * hydrated is exactly the right move — that is how `appendToDocument` rescued
   * an activated-but-unhydrated document, and demanding hydration up front
   * turned that rescue into a silent no-op that left every later save refused.
   */
  const isEditorTargeting = useCallback(
    (id: string) => useDocumentStore.getState().activeDocId === id,
    []
  );

  // Create + persist a batch of import items (each with an optional in-archive
  // folder path), creating folders as needed. Shared by file-drop import and
  // URL import so both get identical folder handling and canonical capture.
  const importItems = useCallback(async (
    items: { raw: string; format: IngestFormat; folderPath: string[] }[]
  ): Promise<{ importedCount: number; failedCount: number; firstDocId: string | null }> => {
    let importedCount = 0;
    let failedCount = 0;
    let firstDocId: string | null = null;

    // Import ACTIVATES the first imported document and overwrites both panes, so
    // it is a document-leaving path like a switch or a close — and it was the
    // only one that never said goodbye to the document already open. Anything
    // typed in the current autosave window was destroyed outright: not on disk,
    // not in the draft cache, not in undo.
    await prepareToLeaveActiveDoc();

    const folderIdByPath = new Map<string, string>();
    const ensureFolder = (segments: string[]): string | null => {
      let parentId: string | null = null;
      let acc = "";
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        let id = folderIdByPath.get(acc);
        if (!id) {
          // No `startNaming` — these folders are created FOR the user (archive
          // import, first-run seeding), not by them. Opting in here opened a
          // focused rename box on load, leaving a caret blinking in the library.
          id = useFolderStore.getState().createFolder(seg, parentId);
          folderIdByPath.set(acc, id);
        }
        parentId = id;
      }
      return parentId;
    };

    // Every file is converted HEADLESSLY against the editor's schema — the live
    // one when an editor is mounted, the identical serialisation schema when
    // not. The loop used to BORROW the live editor per file (activate, push the
    // HTML in, yield a frame, read the canonical back): a click in the library
    // during that frame hydrated the user's own document, and the fallback then
    // persisted the file's pre-editor canonical — an empty "Untitled" — and
    // counted it as imported, while each later file yanked the store back off
    // the user's choice. Nothing here activates a document or touches the
    // editor now; the caller opens the first import through handleSwitchDoc,
    // the ordinary leaving path.
    const schema = tiptapRef.current?.getEditor?.()?.schema ?? headlessSchema();
    let firstDoc: DocumentRecord | null = null;

    for (const item of items) {
      const doc = createDoc(item.raw, item.format, "file-import", { mdToHtml: engine?.mdToHtml });
      if (!doc) continue;
      if (!firstDocId) { firstDocId = doc.id; firstDoc = doc as DocumentRecord; }
      const folderId = item.folderPath.length ? ensureFolder(item.folderPath) : null;

      // Persistence failures (quota, adapter errors) are counted so callers
      // can report the truth instead of "Imported N".
      try {
        captureIngestHeadless(doc as DocumentRecord, schema);
        await saveNewDoc(doc as DocumentRecord);
      } catch (e) {
        console.warn("[importItems] Persist failed for imported doc:", e);
        failedCount++;
        continue;
      }
      if (folderId) useFolderStore.getState().moveDoc(doc.id, folderId);
      importedCount++;
    }

    // With NO editor mounted (an empty library) the caller's switch would
    // hydrate an editor that does not exist yet. Open the first import here,
    // once the editor has mounted for it; handleSwitchDoc then finds it open.
    if (firstDoc && importedCount > 0 && !useDocumentStore.getState().activeDocId) {
      await finalizeDoc(firstDoc, null, true);          // activate only — already persisted
      const editor = await waitForEditor(2000);
      if (editor && useDocumentStore.getState().activeDocId === firstDoc.id) {
        hydrateEditorWithDoc(firstDoc.id, firstDoc.canonical);
      }
    }

    return { importedCount, failedCount, firstDocId };
  }, [createDoc, engine, finalizeDoc, saveNewDoc, waitForEditor, prepareToLeaveActiveDoc, hydrateEditorWithDoc, tiptapRef]);

  // Create a document from URL-fetched (or pasted) content. Routes through the
  // same createDoc → ingest/sanitize → Tiptap path as file import, so remote
  // HTML is sanitized before it ever reaches the editor.
  const handleImportUrl = useCallback(async (resource: ImportResource, selectedPaths?: string[]) => {
    try {
      // Build import items from the fetched resource. Archives contribute one item
      // per selected entry (carrying its in-archive folder path); a single text
      // doc contributes one root item.
      let items: { raw: string; format: IngestFormat; folderPath: string[] }[];
      if (resource.kind === "archive") {
        const keep = selectedPaths ? new Set(selectedPaths) : null;
        const chosen = keep ? resource.entries.filter((e) => keep.has(e.path)) : resource.entries;
        items = archiveEntriesToItems(chosen, resource.name).map((e) => ({
          raw: e.text,
          format: e.format,
          folderPath: e.folderPath,
        }));
      } else {
        items = [{ raw: resource.text, format: resource.format, folderPath: [] }];
      }

      if (!items.length) { toast.show("Nothing selected to import", "warning"); return; }

      const { importedCount, failedCount, firstDocId } = await importItems(items);
      if (firstDocId) {
        await handleSwitchDoc(firstDocId); // hydrates the editor (see file-import path)
      }
      setShowUrlImport(false);
      setImportUrlSeed(null);
      if (failedCount > 0) {
        toast.show(`${failedCount} document(s) could not be saved — storage may be full`, "error");
      }
      if (importedCount > 0) {
        toast.show(
          importedCount > 1 ? `Imported ${importedCount} documents` : "Imported from URL",
          "success",
        );
      }
    } catch {
      toast.show("Import failed", "error");
    }
  }, [importItems, handleSwitchDoc, toast]);

  return { waitForEditor, activateAndCapture, isEditorTargeting, importItems, handleImportUrl };
}

/**
 * Turn files picked or dropped for import into import items. Archives
 * (zip/tar/tgz/gz) expand into one item per entry, carrying its in-archive
 * folder path, and prompt for the password of a protected ZIP; `.docx` goes
 * through the lazy mammoth converter to HTML; images are ignored; everything
 * else is read as text. Files that cannot be taken are named in `skipped`.
 */
export async function collectImportItems(
  files: File[],
  promptText: PromptText,
): Promise<{ items: { raw: string; format: IngestFormat; folderPath: string[] }[]; skipped: string[] }> {
  const skipped: string[] = [];

  // Expand archives (zip/tar/tgz/gz) into per-entry items carrying their
  // in-archive folder path; regular files import at the root.
  const items: { raw: string; format: IngestFormat; folderPath: string[] }[] = [];
  for (const file of files) {
    if (file.type?.startsWith("image/")) continue;
    if (isArchiveName(file.name)) {
      // Password-protected ZIPs are detected inside extractArchive; prompt for
      // the password (masked) and retry, up to a few attempts on a wrong one.
      let extracted: ArchiveEntry[] | null = null;
      let password: string | undefined;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          extracted = await extractArchive(file, password ? { password } : {});
          break;
        } catch (err) {
          if (err instanceof ArchiveEncryptedError || err instanceof ArchiveWrongPasswordError) {
            const pw = await promptText(
              err instanceof ArchiveWrongPasswordError ? "Incorrect password — try again" : "Enter password",
              { description: `"${file.name}" is password-protected.`, placeholder: "Password", type: "password" }
            );
            if (!pw) break; // cancelled
            password = pw;
            continue;
          }
          break; // other error → skip
        }
      }
      if (extracted) {
        for (const e of archiveEntriesToItems(extracted, file.name)) {
          items.push({ raw: e.text, format: e.format, folderPath: e.folderPath });
        }
      } else {
        skipped.push(file.name);
      }
      continue;
    }
    if ((file.size ?? 0) > 5_000_000) {
      skipped.push(file.name);
      continue;
    }
    // DOCX: a binary format — must NOT go through getFileContentAndFormat
    // (which readFileAsText's it into garbage). Convert to HTML first (lazy
    // mammoth) and feed the existing "html" ingest path (sanitize + analyze).
    if (/\.docx$/i.test(file.name)) {
      try {
        const { convertDocxToHtml } = await import("../store/docx-import");
        const { html } = await convertDocxToHtml(file);
        if (html.trim()) {
          items.push({ raw: html, format: "html", folderPath: [] });
        } else {
          skipped.push(file.name);
        }
      } catch {
        skipped.push(file.name);
      }
      continue;
    }
    const { raw, format } = await getFileContentAndFormat(file);
    items.push({ raw, format: format as IngestFormat, folderPath: [] });
  }
  return { items, skipped };
}
