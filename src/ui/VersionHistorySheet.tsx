import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { AlertCircle, History, RotateCcw, Trash2, FilePlus2 } from "lucide-react";
import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTickWhileActive } from "../hooks/useTickWhileActive";
import { useDocumentStore } from "../store/documentStore";
import {
  formatSnapshotBytes,
  snapshotStore,
  type SnapshotMeta,
  type SnapshotReason,
} from "../store/snapshot-store";
import { useUIStore } from "../store/uiStore";
import { useDialog, type ConfirmOptions } from "./DialogProvider";

interface VersionHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeDocId: string | null;
  /** Restore a snapshot into the current editor (destructive to current, but
   *  the current state is snapshotted first so it is reversible). */
  onRestoreInPlace: (snapshotId: number) => Promise<void> | void;
  /** Restore a snapshot as a brand-new document (non-destructive). */
  onRestoreAsNew: (meta: SnapshotMeta) => Promise<void> | void;
}

const REASON_LABEL: Record<SnapshotReason, string> = {
  autosave: "Auto-saved version",
  "pre-clear": "Before content was cleared/shrunk",
  "pre-delete": "Before the document was deleted",
  "pre-restore": "Before a restore",
  manual: "Manual snapshot",
};

/**
 * What deleting one snapshot costs, said plainly. Deleting a version used to be
 * a single un-confirmed click — and for a document that is no longer in the
 * library, its snapshots (the "pre-delete" one above all) are the ONLY copies
 * left anywhere, so that click could destroy the last trace of it.
 */
export function snapshotDeleteConfirm(
  meta: Pick<SnapshotMeta, "title">,
  opts: { docInLibrary: boolean; remainingForDoc: number },
): ConfirmOptions {
  const title = meta.title || "Untitled";
  let description: string;
  if (opts.docInLibrary) {
    description =
      "This saved version is removed from Version history for good. The document itself is not changed.";
  } else if (opts.remainingForDoc <= 1) {
    description = `This is the last remaining copy of “${title}”, which is no longer in your library. Once it is deleted, the document cannot be recovered.`;
  } else {
    description = `“${title}” is no longer in your library, so its saved versions are the only copies left. This one cannot be recovered once it is deleted.`;
  }
  return { title: "Delete this version?", description, confirmLabel: "Delete version", destructive: true };
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return d.toLocaleString();
}

/**
 * Version history (Tools → Version history…). Surfaces the recoverable snapshot
 * net: prior content versions kept per document so an overwrite, clear, or
 * delete can be undone even after a reload. The current document's versions are
 * shown first; snapshots for documents no longer in the library (e.g. deleted)
 * appear under "Other & deleted documents" and can be restored as new documents.
 */
function VersionHistorySheetInner({
  open,
  onOpenChange,
  activeDocId,
  onRestoreInPlace,
  onRestoreAsNew,
}: VersionHistorySheetProps) {
  const [byDoc, setByDoc] = useState<Map<string, SnapshotMeta[]>>(new Map());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useDialog();
  // Restoring writes a document and deleting a version destroys recoverable
  // data; read-only mode gates every mutation, and these are two of them.
  const readOnly = useUIStore((s) => s.readOnly);
  const documents = useDocumentStore((s) => s.documents);
  const libraryIds = useMemo(() => new Set(documents.map((d) => d.id)), [documents]);
  // `formatWhen` reads Date.now() at render, so the relative timestamps need a
  // reason to re-render while the sheet is open — see useTickWhileActive.
  useTickWhileActive(open, 30_000);

  const reload = useCallback(async () => {
    setByDoc(await snapshotStore.listAll());
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(null);
    void reload();
    return snapshotStore.subscribe(() => { void reload(); });
  }, [open, reload]);

  const current = (activeDocId && byDoc.get(activeDocId)) || [];
  const others = Array.from(byDoc.entries()).filter(([id]) => id !== activeDocId);

  const doRestoreInPlace = async (m: SnapshotMeta) => {
    if (readOnly) return;
    setBusy(m.id);
    try { await onRestoreInPlace(m.id); onOpenChange(false); }
    finally { setBusy(null); }
  };
  const doRestoreAsNew = async (m: SnapshotMeta) => {
    if (readOnly) return;
    setBusy(m.id);
    try { await onRestoreAsNew(m); onOpenChange(false); }
    finally { setBusy(null); }
  };
  // Confirmed, awaited, and reported. It was one un-confirmed click whose
  // promise nobody awaited, so a failure vanished and a success could remove
  // the only surviving copy of a deleted document without a word.
  const doDelete = async (m: SnapshotMeta) => {
    if (readOnly || busy != null) return;
    const ok = await confirm(
      snapshotDeleteConfirm(m, {
        docInLibrary: libraryIds.has(m.docId),
        remainingForDoc: byDoc.get(m.docId)?.length ?? 1,
      }),
    );
    if (!ok) return;
    setBusy(m.id);
    setError(null);
    try {
      await snapshotStore.deleteOne(m.id);
    } catch {
      setError("That version could not be deleted. It is still listed below.");
    } finally {
      setBusy(null);
    }
  };

  const row = (m: SnapshotMeta, opts: { inPlace: boolean }, i: number) => (
    <li
      key={m.id}
      className={cn("flex items-center gap-2 px-3 py-2.5", i % 2 === 1 && "bg-card/40")}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{REASON_LABEL[m.reason]}</p>
        <p className="text-[11px] text-muted-foreground">
          {formatWhen(m.ts)} · {m.words} word{m.words === 1 ? "" : "s"} · {formatSnapshotBytes(m.bytes)}
        </p>
      </div>
      {opts.inPlace && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 shrink-0 gap-1 text-xs pointer-coarse:h-9"
          disabled={busy != null || readOnly}
          onClick={() => doRestoreInPlace(m)}
        >
          <RotateCcw className="size-3.5" /> Restore
        </Button>
      )}
      <Button
        size="sm"
        variant={opts.inPlace ? "ghost" : "outline"}
        className="h-7 shrink-0 gap-1 text-xs pointer-coarse:h-9"
        disabled={busy != null || readOnly}
        onClick={() => doRestoreAsNew(m)}
        title="Restore this version as a new document"
      >
        <FilePlus2 className="size-3.5" /> As new
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 shrink-0 text-muted-foreground hover:text-destructive pointer-coarse:size-9"
        aria-label="Delete this version"
        disabled={busy != null || readOnly}
        onClick={() => void doDelete(m)}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </li>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] p-0 sm:w-[460px]">
        <SheetHeader className="px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <History className="size-4" /> Version history
          </SheetTitle>
          <SheetDescription>
            Recoverable snapshots kept automatically before content is overwritten,
            cleared, or deleted. These survive reloads. Restore in place (your
            current content is snapshotted first) or as a new document.
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <ScrollArea className="h-[calc(100vh-8.5rem)]">
          <div className="space-y-6 px-5 py-4">
            {readOnly && (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Read-only mode is on. Turn it off (View menu or Settings) to restore or delete versions.
              </p>
            )}
            {error && (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                This document
              </p>
              {current.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  No snapshots yet. As you edit, prior versions are captured here
                  automatically so nothing gets lost.
                </p>
              ) : (
                <ul className="overflow-hidden rounded-md border border-border">
                  {current.map((m, i) => row(m, { inPlace: true }, i))}
                </ul>
              )}
            </div>

            {others.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Other &amp; deleted documents
                </p>
                <div className="space-y-3">
                  {others.map(([docId, snaps]) => (
                    <div key={docId}>
                      <p className="mb-1 truncate text-[11px] font-medium text-muted-foreground">
                        {snaps[0]?.title || "Untitled"}
                        {!libraryIds.has(docId) && (
                          <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] uppercase tracking-wide">deleted</span>
                        )}
                      </p>
                      <ul className="overflow-hidden rounded-md border border-border">
                        {snaps.map((m, i) => row(m, { inPlace: false }, i))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// Memoized: this stays MOUNTED while closed so its sheet/dialog can animate
// out, and without a memo it re-ran its whole body — and, for the settings
// sheet, ~26 store subscriptions — on every render of the editor shell,
// i.e. on every keystroke, to produce a tree nobody was looking at.
export const VersionHistorySheet = React.memo(VersionHistorySheetInner);
