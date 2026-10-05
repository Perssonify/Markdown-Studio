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
import { AlertCircle, Cloud, History, RotateCcw, Trash2, FilePlus2 } from "lucide-react";
import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTickWhileActive } from "../hooks/useTickWhileActive";
import { useAccountVersions, type AccountVersion, type AccountVersionsProvider } from "../store/account-versions";
import { useDocumentStore } from "../store/documentStore";
import {
  formatSnapshotBytes,
  snapshotStore,
  type SnapshotMeta,
  type SnapshotReason,
} from "../store/snapshot-store";
import { useUIStore } from "../store/uiStore";
import { useDialog, type ConfirmOptions } from "./DialogProvider";
import { t, useT } from "../i18n";

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
  get autosave() { return t("dialogs.reasonAutosave"); },
  get "pre-clear"() { return t("dialogs.reasonPreClear"); },
  get "pre-delete"() { return t("dialogs.reasonPreDelete"); },
  get "pre-restore"() { return t("dialogs.reasonPreRestore"); },
  get "pre-link-update"() { return t("dialogs.reasonPreLinkUpdate"); },
  get "tab-conflict"() { return t("dialogs.reasonTabConflict"); },
  get "cloud-sync"() { return t("dialogs.reasonCloudSync"); },
  get "account-version"() { return t("dialogs.reasonAccountVersion"); },
  get manual() { return t("dialogs.reasonManual"); },
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
  const title = meta.title || t("common.untitled");
  let description: string;
  if (opts.docInLibrary) {
    description =
      t("dialogs.deleteVersionInLibrary");
  } else if (opts.remainingForDoc <= 1) {
    description = t("dialogs.deleteVersionLastCopy", { title });
  } else {
    description = t("dialogs.deleteVersionNotInLibrary", { title });
  }
  return { title: t("dialogs.deleteThisVersionQuestion"), description, confirmLabel: t("dialogs.deleteVersion"), destructive: true };
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return t("dialogs.justNow");
  if (mins < 60) return t("dialogs.minutesAgo", { count: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("dialogs.hoursAgo", { count: hrs });
  return d.toLocaleString();
}

type AccountList =
  | { docId: string; state: "loading" }
  | { docId: string; state: "failed" }
  | { docId: string; state: "ready"; versions: AccountVersion[] };

/**
 * The account's earlier versions of the current note (only while the app syncs
 * with an account). Bringing one back stores it as an ordinary snapshot, then
 * restores that — so it is undone the way any restore is.
 */
function AccountVersionsSection({
  provider,
  docId,
  disabled,
  onRestoreInPlace,
  onRestoreAsNew,
}: {
  provider: AccountVersionsProvider;
  docId: string;
  disabled: boolean;
  onRestoreInPlace: (snapshotId: number) => Promise<void>;
  onRestoreAsNew: (meta: SnapshotMeta) => Promise<void>;
}) {
  const t = useT();
  const [list, setList] = useState<AccountList>({ docId, state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setList({ docId, state: "loading" });
    provider.list(docId).then(
      (versions) => live && setList({ docId, state: "ready", versions }),
      () => live && setList({ docId, state: "failed" }),
    );
    return () => { live = false; };
  }, [provider, docId]);

  const bringBack = async (v: AccountVersion, asNew: boolean) => {
    if (disabled || busy) return;
    setBusy(v.id);
    setFailed(false);
    try {
      const id = await provider.bringBack(docId, v.id);
      const meta = id == null ? undefined : (await snapshotStore.listForDoc(docId)).find((m) => m.id === id);
      if (id == null || !meta) {
        setFailed(true);
        return;
      }
      if (asNew) await onRestoreAsNew(meta);
      else await onRestoreInPlace(id);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  // A list loaded for the previous note is not this note's.
  const shown: AccountList = list.docId === docId ? list : { docId, state: "loading" };
  const note = (text: string) => (
    <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">{text}</p>
  );
  let body: React.ReactNode;
  if (shown.state === "loading") body = note(t("dialogs.accountVersionsLoading"));
  else if (shown.state === "failed") body = note(t("dialogs.accountVersionsUnavailable"));
  else if (shown.versions.length === 0) body = note(t("dialogs.accountVersionsNone"));
  else {
    body = (
      <ul className="overflow-hidden rounded-md border border-border">
        {shown.versions.map((v, i) => (
          <li key={v.id} className={cn("flex items-center gap-2 px-3 py-2.5", i % 2 === 1 && "bg-card/40")}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{t("dialogs.accountVersion")}</p>
              <p className="text-[11px] text-muted-foreground">{formatWhen(v.at)}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 gap-1 text-xs pointer-coarse:h-9"
              disabled={disabled || busy != null}
              onClick={() => void bringBack(v, false)}
            >
              <RotateCcw className="size-3.5" /> {t("dialogs.restore")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 gap-1 text-xs pointer-coarse:h-9"
              disabled={disabled || busy != null}
              onClick={() => void bringBack(v, true)}
              title={t("dialogs.restoreThisVersionAsA")}
            >
              <FilePlus2 className="size-3.5" /> {t("dialogs.asNew")}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <Cloud className="size-3.5" /> {t("dialogs.inYourAccount")}
      </p>
      <p className="mb-2 text-[11px] text-muted-foreground">{t("dialogs.accountVersionsHint")}</p>
      {failed && (
        <p role="alert" className="mb-2 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <span>{t("dialogs.accountVersionCouldNotBeBroughtBack")}</span>
        </p>
      )}
      {body}
    </div>
  );
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
  const t = useT();
  const [byDoc, setByDoc] = useState<Map<string, SnapshotMeta[]>>(new Map());
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm } = useDialog();
  const accountVersions = useAccountVersions();
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
      setError(t("dialogs.versionCouldNotBeDeleted"));
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
          {formatWhen(m.ts)} · {t("dialogs.wordCount", { count: m.words })} · {formatSnapshotBytes(m.bytes)}
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
          <RotateCcw className="size-3.5" /> {t("dialogs.restore")}
        </Button>
      )}
      <Button
        size="sm"
        variant={opts.inPlace ? "ghost" : "outline"}
        className="h-7 shrink-0 gap-1 text-xs pointer-coarse:h-9"
        disabled={busy != null || readOnly}
        onClick={() => doRestoreAsNew(m)}
        title={t("dialogs.restoreThisVersionAsA")}
      >
        <FilePlus2 className="size-3.5" /> {t("dialogs.asNew")}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-6 shrink-0 text-muted-foreground hover:text-destructive pointer-coarse:size-9"
        aria-label={t("dialogs.deleteThisVersion")}
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
            <History className="size-4" /> {t("dialogs.versionHistory")}
          </SheetTitle>
          <SheetDescription>
            {t("dialogs.recoverableSnapshotsKeptAutomaticallyBefore")}
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <ScrollArea className="h-[calc(100vh-8.5rem)]">
          <div className="space-y-6 px-5 py-4">
            {readOnly && (
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t("dialogs.readOnlyModeIsOn")}
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
                {t("dialogs.thisDocument")}
              </p>
              {current.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("dialogs.noSnapshotsYetAsYou")}
                </p>
              ) : (
                <ul className="overflow-hidden rounded-md border border-border">
                  {current.map((m, i) => row(m, { inPlace: true }, i))}
                </ul>
              )}
            </div>

            {accountVersions && activeDocId && (
              <AccountVersionsSection
                provider={accountVersions}
                docId={activeDocId}
                disabled={readOnly || busy != null}
                onRestoreInPlace={async (id) => { await onRestoreInPlace(id); onOpenChange(false); }}
                onRestoreAsNew={async (meta) => { await onRestoreAsNew(meta); onOpenChange(false); }}
              />
            )}

            {others.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("dialogs.otherAndDeletedDocuments")}
                </p>
                <div className="space-y-3">
                  {others.map(([docId, snaps]) => (
                    <div key={docId}>
                      <p className="mb-1 truncate text-[11px] font-medium text-muted-foreground">
                        {snaps[0]?.title || t("common.untitled")}
                        {!libraryIds.has(docId) && (
                          <span className="ml-1.5 rounded bg-muted px-1 py-px text-[10px] uppercase tracking-wide">{t("dialogs.deleted")}</span>
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
