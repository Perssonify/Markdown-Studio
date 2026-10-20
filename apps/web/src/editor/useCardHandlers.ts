import { type MutableRefObject, useCallback, useRef } from "react";
import { canonicalToMarkdown } from "../engine/serialize-doc";
import { htmlToCanonical } from "../store/documents/canonical-ops";
import { carryBlockAttrs } from "../store/cards/card-save";
import type { DocumentRecord } from "../store/documents/document";
import { ConflictError, useDocumentStore } from "../store/documents/documentStore";
import { computeFidelity } from "../store/documents/fidelity";
import type { FolderTreeData } from "../store/documents/folders";
import { sanitizeForIngest } from "../store/importExport/ingest";
import { canonicalMisfit, isNewerSchema } from "../store/documents/schema-version";
import { isLockedShare } from "../store/documents/live-share-meta";
import { snapshotStore } from "../store/history/snapshot-store";
import { t } from "../i18n";
import type { DocStore, Engine, Lifecycle, LinkIndexApi, SyncEngine, TiptapRef, Toast } from "./types";
import type { useImportPipeline } from "./useImportPipeline";

type ImportPipeline = ReturnType<typeof useImportPipeline>;

interface CardHandlersParams {
  tiptapRef: TiptapRef;
  engine: Engine;
  getCanonical: SyncEngine["getCanonical"];
  createDoc: DocStore["createDoc"];
  patchDocById: DocStore["patchDocById"];
  /** Folder membership, for the folder name on each card. */
  folderState: Pick<FolderTreeData, "folders" | "docParents">;
  prepareToLeaveActiveDoc: Lifecycle["prepareToLeaveActiveDoc"];
  hydrateEditorWithDoc: Lifecycle["hydrateEditorWithDoc"];
  handleSwitchDoc: Lifecycle["handleSwitchDoc"];
  activateAndCapture: ImportPipeline["activateAndCapture"];
  isEditorTargeting: ImportPipeline["isEditorTargeting"];
  rebuildLinks: LinkIndexApi["rebuildLinks"];
  toast: Toast;
  /** The latest toast, for a failure reported after an await. */
  toastRef: MutableRefObject<Toast>;
}

/**
 * The Cards board's handlers: load a card (live canonical for the document the
 * editor holds), its markdown source and rendered view, quick capture (a
 * document-LEAVING path that returns to the open document afterwards), save a
 * card edit, and per-card colour/pin metadata.
 */
export function useCardHandlers({
  tiptapRef, engine, getCanonical, createDoc, patchDocById, folderState,
  prepareToLeaveActiveDoc, hydrateEditorWithDoc, handleSwitchDoc,
  activateAndCapture, isEditorTargeting, rebuildLinks, toast, toastRef,
}: CardHandlersParams) {
  // ── Cards board handlers ───────────────────────────────────────────────────
  // The board never touches the canonical directly. Writes route through the
  // SAME guarded path the host bridge's updateDocument uses: parse markdown with
  // the live editor's schema, persist via patchDocById, and re-hydrate the live
  // editor when the edited doc is the active one — otherwise the editor would
  // keep (and later autosave) the pre-edit content over the change.
  // The revision each opened card was read from. A card edit is saved later,
  // after the board has closed it; if another tab wrote the note in between,
  // replacing the whole document with the card's text would overwrite that
  // tab's work — patchDocById refuses when the stored copy is newer than this.
  const cardBasesRef = useRef(new Map<string, string>());
  const cardLoadDoc = useCallback(async (id: string) => {
    const store = useDocumentStore.getState();
    const rec = await store.getDocById(id);
    if (!rec) return null;
    cardBasesRef.current.set(id, rec.updated);
    // Prefer the LIVE editor canonical for the document the editor currently
    // holds. Reading the stored copy meant a card opened during the autosave
    // window was seeded with pre-edit text, and saving that card wrote it back
    // over the newer content — the last few seconds of typing gone from disk AND
    // from the editor, with no snapshot and no undo. Unbounded, not bounded by
    // the autosave interval, whenever the save is parked in "blocked"/"conflict"
    // and the stored copy is therefore arbitrarily old. Same idiom as
    // `headingsForDoc` / `liveCanonicalFor`.
    const live = store.hydratedDocId === id ? getCanonical() : null;
    return {
      id: rec.id,
      title: rec.title,
      updated: rec.updated,
      created: rec.created,
      canonical: live ?? rec.canonical,
      metadata: rec.metadata || {},
    };
  }, [getCanonical]);

  // The card's editable source. STYLED, never Clean: a card save replaces the
  // whole note with what this source parses back to, and the Clean converter
  // has no carrier for colour, highlight or font — one card edit stripped them
  // from the entire document (reproduced by the audit). Styled keeps them as
  // inline `<span style>`, which parses back to the same marks. Alignment has
  // no carrier in either; handleCardSave restores it on unchanged blocks.
  const cardToMarkdown = useCallback(
    (canonical: unknown) => {
      const convert = engine?.htmlToMd ?? engine?.htmlToCleanMd;
      return (convert ? canonicalToMarkdown(canonical, convert) : null) ?? "";
    },
    [engine]
  );

  // Markdown → SANITISED HTML for the opened card's rendered view. Reuses the
  // exact markdown engine the rich pane is built from (so a card renders
  // identically) and the ingest sanitizer (so injected HTML can't carry a
  // script/handler). Returns "" when the engine isn't ready, which makes the
  // card editor fall back to markdown-only rather than showing nothing.
  const cardRenderMarkdown = useCallback(
    (markdown: string) => {
      if (!engine?.mdToHtml) return "";
      try { return sanitizeForIngest(engine.mdToHtml(markdown)); } catch { return ""; }
    },
    [engine]
  );

  const handleCardCreate = useCallback(async (markdown: string) => {
    const doc = createDoc(markdown, "markdown", "api", { mdToHtml: engine?.mdToHtml });
    if (!doc) { toast.show(t("editor.couldNotCreateNote"), "error"); return; }
    // Quick capture ACTIVATES the new note and overwrites both panes (setFromHtml
    // also drops both undo stacks), so it is a document-LEAVING path and owes
    // the open document the same goodbye as import and addDocuments. It had
    // none. The surface-open flush above is not a substitute: it only fires on
    // saveStatus "editing", so a document whose last save FAILED or parked on
    // "conflict" was never flushed and never cached — its edits were on no disk,
    // in no draft, in no undo stack and in no snapshot.
    const previousDocId = useDocumentStore.getState().activeDocId;
    await prepareToLeaveActiveDoc();
    await activateAndCapture(doc as DocumentRecord);
    // …and go back where the user was. Capturing a note from the board is not a
    // request to open it; importItems switches back for the same reason.
    if (previousDocId && previousDocId !== doc.id) {
      await handleSwitchDoc(previousDocId);
    }
    try { await rebuildLinks(); } catch { /* index refresh is best-effort */ }
  }, [createDoc, engine, activateAndCapture, prepareToLeaveActiveDoc, handleSwitchDoc, rebuildLinks, toast]);

  const handleCardSave = useCallback(async (id: string, markdown: string) => {
    const editor = tiptapRef.current?.getEditor();
    if (!editor?.schema) { toast.show(t("editor.editorNotReadyNoteNotSaved"), "error"); return; }
    const html = engine?.mdToHtml ? engine.mdToHtml(markdown) : markdown;
    const canonical = htmlToCanonical(html, editor.schema);
    // A note from a newer build cannot be shown as a card (its source reads
    // back EMPTY), so saving the card would replace the whole note with only
    // what was typed. Refuse; keep the typing recoverable.
    const current = await useDocumentStore.getState().getDocById(id).catch(() => null);
    if (current && (isNewerSchema(current.schemaVersion) || canonicalMisfit(current.canonical, editor.schema))) {
      void snapshotStore.record(id, current.title || "Untitled", canonical, "manual").catch(() => {});
      toast.show(t("editor.cardNewerVersion"), "warning");
      return;
    }
    // A shared document that is read-only here (a live copy being followed, a
    // read-only share): the editor opens it read-only, and so must its card.
    if (current && isLockedShare(current.metadata)) {
      void snapshotStore.record(id, current.title || "Untitled", canonical, "manual").catch(() => {});
      toast.show(t("editor.cardSharedReadOnly"), "warning");
      return;
    }
    // What this edit REPLACES — the live editor's copy when it holds the note.
    // Alignment cannot survive the markdown round trip, so carry it over onto
    // every block the edit left unchanged; and when the note holds anything the
    // round trip cannot carry, keep the version being replaced recoverable.
    const replaced = useDocumentStore.getState().hydratedDocId === id ? getCanonical() : current?.canonical;
    let carried = { doc: canonical as unknown, lost: 0 };
    if (replaced) {
      carried = carryBlockAttrs(replaced, canonical);
      if (!computeFidelity(replaced as DocumentRecord["canonical"], "styled").lossless) {
        void snapshotStore.record(id, current?.title || "Untitled", replaced, "autosave").catch(() => {});
      }
    }
    let patched: DocumentRecord | null;
    try {
      patched = await patchDocById(id, {
        canonical: carried.doc as DocumentRecord["canonical"],
        expectedUpdated: cardBasesRef.current.get(id) ?? null,
      });
    } catch (e) {
      // Refused (another tab wrote this note after the card was opened) or the
      // write failed. The board has already closed the card, so its text exists
      // nowhere else: keep it recoverable in Version history, never drop it.
      const title = useDocumentStore.getState().documents.find((d) => d.id === id)?.title ?? "Untitled";
      void snapshotStore.record(id, title, canonical, "manual").catch(() => {});
      toast.show(
        e instanceof ConflictError
          ? t("editor.cardConflict")
          : t("editor.cardSaveFailed"),
        "warning",
      );
      return;
    }
    if (patched) cardBasesRef.current.set(id, patched.updated);
    if (carried.lost > 0) {
      toast.show(t("editor.cardAlignmentLost"), "info");
    }
    // Re-check AFTER the await, never before it. `patchDocById` writes to
    // IndexedDB, which is slow enough that a document switch routinely lands
    // during it — and a pre-await "is this the active doc?" snapshot would then
    // push THIS document's content into the editor now holding a DIFFERENT one,
    // which autosave duly persists under the other document's id. The save-side
    // analogue of `saveActiveDoc`'s post-await hydration re-assert.
    if (patched?.canonical && isEditorTargeting(id)) {
      hydrateEditorWithDoc(id, patched.canonical);
    }
    try { await rebuildLinks(); } catch { /* index refresh is best-effort */ }
  }, [engine, patchDocById, hydrateEditorWithDoc, rebuildLinks, toast, isEditorTargeting, getCanonical]);

  const handleCardMeta = useCallback(
    async (id: string, metadata: Record<string, unknown>) => {
      // Presentation-only: don't bump `updated`, or pinning a note would
      // re-sort the board as if it had been edited. touchUpdated:false writes
      // the metadata ONLY, onto the freshest stored copy.
      try {
        await patchDocById(id, { metadata, touchUpdated: false });
      } catch {
        toastRef.current.show(t("editor.cardChangeNotSaved"), "error");
      }
    },
    [patchDocById]
  );

  const cardFolderName = useCallback(
    (id: string) => {
      const parent = folderState.docParents?.[id];
      if (!parent) return null;
      return folderState.folders?.find((f) => f.id === parent)?.name ?? null;
    },
    [folderState]
  );

  return {
    cardLoadDoc, cardToMarkdown, cardRenderMarkdown,
    handleCardCreate, handleCardSave, handleCardMeta, cardFolderName,
  };
}
