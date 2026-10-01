import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import React from "react";
import { useSyncExternalStore } from "react";
import { displayKeys } from "../data/shortcuts";
import { useTickWhileActive } from "../hooks/useTickWhileActive";
import { useDocumentStore } from "../store/documentStore";
import {
  formatEstBytes,
  HISTORY_CACHE_LIMITS,
  historyCache,
} from "../store/history-cache";
import { useT } from "../i18n";

interface MemorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Chromium exposes JS-heap numbers; other engines don't. Best-effort. */
function readHeap(): { used: number; limit: number } | null {
  const m = (performance as unknown as {
    memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
  }).memory;
  if (!m?.usedJSHeapSize || !m.jsHeapSizeLimit) return null;
  return { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit };
}

/**
 * Memory & undo-history management (Tools → Memory & undo history…, and the
 * status-bar memory chip). Observability + governance for the per-document
 * undo-history cache: usage against budget, per-document breakdown, limits,
 * and clear controls. Sizes are estimates — JS cannot measure retained
 * object-graph size, so they derive from content length + per-step allowance.
 */
function MemorySheetInner({ open, onOpenChange }: MemorySheetProps) {
  const t = useT();
  const stats = useSyncExternalStore(
    (cb) => historyCache.subscribe(cb),
    () => historyCache.getStats(),
    () => historyCache.getStats()
  );
  const config = historyCache.getConfig();
  const documents = useDocumentStore((s) => s.documents);
  const draftsCount = useDocumentStore((s) => s._unsavedEdits.size);
  // `readHeap()` is a live reading taken at render, so this component needs a
  // reason to render while the sheet is open — see useTickWhileActive.
  useTickWhileActive(open, 1000);
  const heap = open ? readHeap() : null;

  const titleOf = (docId: string) =>
    documents.find((d) => d.id === docId)?.title ?? t("dialogs.deletedDocument");

  const pct = stats.budgetBytes > 0 ? Math.min(100, (stats.totalEstBytes / stats.budgetBytes) * 100) : 0;
  const barColor = pct >= 100 ? "bg-destructive" : pct >= 75 ? "bg-amber-500" : "bg-primary";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[360px] p-0 sm:w-[420px]">
        <SheetHeader className="px-5 py-4">
          <SheetTitle>{t("dialogs.memoryAndUndoHistory")}</SheetTitle>
          <SheetDescription>
            {t("dialogs.memorySheetDescription", { keys: displayKeys("⌘Z") })}
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <ScrollArea className="h-[calc(100vh-7.5rem)]">
          <div className="space-y-6 px-5 py-4">
            {/* Master toggle */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label htmlFor="history-enabled" className="text-sm font-medium">
                  {t("dialogs.keepUndoHistoryPerDocument")}
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("dialogs.offSwitchingDocumentsStartsEach")}
                </p>
              </div>
              <Switch
                id="history-enabled"
                checked={config.enabled}
                onCheckedChange={(v) => historyCache.setConfig({ enabled: v })}
              />
            </div>

            {/* Usage */}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("dialogs.estimatedUsage")}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatEstBytes(stats.totalEstBytes)} / {formatEstBytes(stats.budgetBytes)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {t("dialogs.documentsCached", { cached: stats.entryCount, count: stats.maxDocs })}
                {draftsCount > 0 && <> · {t("dialogs.unsavedDraftsInMemory", { count: draftsCount })}</>}
                {heap && <> · {t("dialogs.jsHeap", { used: formatEstBytes(heap.used), limit: formatEstBytes(heap.limit) })}</>}
              </p>
            </div>

            {/* Limits */}
            <div className={cn("space-y-4", !config.enabled && "pointer-events-none opacity-50")}>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("dialogs.documentsToRemember")}
                </Label>
                <div className="mt-2 flex gap-1.5">
                  {HISTORY_CACHE_LIMITS.maxDocsOptions.map((n) => (
                    <Button
                      key={n}
                      size="sm"
                      variant={config.maxDocs === n ? "default" : "outline"}
                      className="h-7 flex-1 text-xs tabular-nums"
                      onClick={() => historyCache.setConfig({ maxDocs: n })}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("dialogs.memoryBudgetEstimated")}
                </Label>
                <div className="mt-2 flex gap-1.5">
                  {HISTORY_CACHE_LIMITS.maxMBOptions.map((mb) => (
                    <Button
                      key={mb}
                      size="sm"
                      variant={config.maxMB === mb ? "default" : "outline"}
                      className="h-7 flex-1 text-xs tabular-nums"
                      onClick={() => historyCache.setConfig({ maxMB: mb })}
                    >
                      {t("dialogs.megabytes", { count: mb })}
                    </Button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("dialogs.leastRecentlyUsedDocumentsAre")}
                </p>
              </div>
            </div>

            {/* Per-document breakdown */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("dialogs.cachedDocuments")}
                </span>
                {stats.entryCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                    onClick={() => historyCache.clear()}
                  >
                    {t("dialogs.clearAll")}
                  </Button>
                )}
              </div>
              {stats.entryCount === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                  {t("dialogs.nothingCachedYetSwitchBetween")}
                </p>
              ) : (
                <ul className="overflow-hidden rounded-md border border-border">
                  {stats.entries.slice().reverse().map((e, i) => (
                    <li
                      key={e.docId}
                      className={cn(
                        "flex items-center gap-2 px-3 py-2",
                        i % 2 === 1 && "bg-card/40"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{titleOf(e.docId)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t("dialogs.undoSteps", { count: e.undoSteps })} · ~{formatEstBytes(e.estBytes)}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-6 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={t("dialogs.clearCachedHistoryFor", { title: titleOf(e.docId) })}
                        onClick={() => historyCache.drop(e.docId)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
export const MemorySheet = React.memo(MemorySheetInner);
