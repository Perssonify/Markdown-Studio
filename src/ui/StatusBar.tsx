import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  HardDrive,
  Keyboard,
  Link as LinkIcon,
  Loader2,
  MemoryStick,
  PanelBottom,
  PenLine
} from "lucide-react";
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MODES } from "../constants";
import { SCHEMA_LOCK_ERROR, useDocumentStore } from "../store/documentStore";
import { useEditorStore } from "../store/editorStore";
import { formatEstBytes, historyCache } from "../store/history-cache";
import { useUIStore } from "../store/uiStore";
import { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
import { ResidualsDialog } from "./ResidualsDialog";
import { INITIAL_ANNOUNCER, nextAnnouncement } from "./save-announcer";
import { t, useT } from "../i18n";

/** The status bar reports STATE. It deliberately carries no view switcher:
 *  the relationship-map toggle used to live here as well as in the top bar —
 *  the same Network icon firing the same action from the opposite corner of
 *  the screen — and the graph's JSON export sat beside it even when the map
 *  had never been opened. Both now live where they belong: the surface
 *  switcher in the top bar, the export inside the map's own header. */
export interface StatusBarProps {
  /** Opens the Memory & undo history sheet (also reachable via Tools menu). */
  onOpenMemory?: () => void;
  /** Open the bottom tray on the Document-Links tab (status-bar links chip). */
  onToggleLinks?: () => void;
  /** Whether the tray is open on the links tab (drives the chip's active state). */
  linksActive?: boolean;
  /** Expand/collapse the bottom tray (chevron). */
  onToggleTray?: () => void;
  /** Whether the tray is currently open (drives the chevron direction). */
  trayOpen?: boolean;
}

const MODE_LABEL: Record<string, string> = {
  get [MODES.MD]() { return t("status.modeMarkdown"); },
  get [MODES.HTML]() { return t("status.modeRichText"); },
  get [MODES.SPLIT]() { return t("status.modeSplit"); },
};

function RawStatusBar({ onOpenMemory, onToggleLinks, linksActive, onToggleTray, trayOpen }: StatusBarProps) {
  const t = useT();
  const mode = useUIStore((s) => s.mode);
  const readOnly = useUIStore((s) => s.readOnly);
  // Live estimated memory of the per-doc undo-history cache.
  const memStats = useSyncExternalStore(
    (cb) => historyCache.subscribe(cb),
    () => historyCache.getStats(),
    () => historyCache.getStats()
  );
  const memPct = memStats.budgetBytes > 0 ? (memStats.totalEstBytes / memStats.budgetBytes) * 100 : 0;

  const saveStatus = useDocumentStore((s) => s.saveStatus);
  const saveError = useDocumentStore((s) => s.saveError);
  const counts = useDocumentStore((s) => s.counts);
  const activeDoc = useDocumentStore((s) => s.activeDoc);

  const fidelityReport = useDocumentStore((s) => s.fidelityReport);
  const storageMetrics = useDocumentStore((s) => s.storageMetrics);
  const activeBacklinks = useEditorStore((s) => s.activeBacklinks);
  const activeForwardLinks = useEditorStore((s) => s.activeForwardLinks);
  const activeUnresolved = useEditorStore((s) => s.activeUnresolved);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showResiduals, setShowResiduals] = useState(false);

  // What the live region SAYS is decided separately from what the bar SHOWS:
  // only failures and the recovery from one are announced (see save-announcer).
  // `seq` keys the text node so a repeat of the same sentence is still news.
  const announcerRef = useRef(INITIAL_ANNOUNCER);
  const [announcement, setAnnouncement] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });
  useEffect(() => {
    const { state, message } = nextAnnouncement(announcerRef.current, { status: saveStatus, error: saveError });
    announcerRef.current = state;
    if (message) setAnnouncement((a) => ({ text: message, seq: a.seq + 1 }));
  }, [saveStatus, saveError]);

  // Surface storage usage as it gets high, so users aren't surprised by a
  // hard quota error. Hidden below 60% to avoid noise.
  const storagePct = storageMetrics ? Math.round(storageMetrics.pct) : 0;
  const showStorage = !!storageMetrics && storagePct >= 60;
  const storageCritical = storagePct >= 90;

  const wordCount = counts.words;
  const charCount = counts.chars;
  const residualCount = activeDoc?.residuals?.length || 0;
  const linkCount = activeBacklinks.length + activeForwardLinks.length;
  const hasLinks = linkCount > 0 || activeUnresolved.length > 0;

  const fidelityBadge = fidelityReport && !fidelityReport.lossless && mode !== MODES.HTML
    ? fidelityReport.summary
    : null;

  return (
    /* No role="status"/aria-live on the FOOTER. It wrapped the doc title, view
       mode, badges, links chip, storage percentage and the word/character
       counters — and `updateCounts` writes a fresh counts object on every
       keystroke, so a screen reader announced the whole status bar continuously
       while the user typed, and the implicit `contentinfo` landmark was lost.
       Only the save-state block below is genuinely a live status. */
    <footer
      data-print-hide
      className="pf-safe-bottom shrink-0 flex items-stretch justify-between gap-1 min-h-7 pointer-coarse:min-h-9 bg-muted/50 border-t border-border text-[11px] text-muted-foreground select-none transition-colors duration-200"
    >
      {/* ── Far-left: the primary, obvious tray expand/collapse control. A
          full-height, bordered, labeled chevron so it reads unmistakably as
          "open the panel", echoing the chevrons the old backlinks bar had.
          A096: its accessible name contains its visible label ("Panel") — it
          used to be "Expand bottom tray", which a speech-input user saying
          "click Panel" could not reach — and it is a disclosure, so the state
          rides aria-expanded rather than a name that changes. */}
      {onToggleTray ? (
        <button
          type="button"
          onClick={onToggleTray}
          aria-expanded={!!trayOpen}
          className={`group flex items-center gap-1.5 pl-2.5 pr-2 border-r transition-colors ${
            trayOpen
              ? "bg-primary/10 text-primary-strong border-primary/30"
              : "text-muted-foreground border-border hover:bg-accent hover:text-foreground"
          }`}
          title={trayOpen ? t("status.collapsePanelTray") : t("status.expandPanelTray")}
          aria-label={t("status.panelTray")}
        >
          <PanelBottom className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden font-medium sm:inline">{t("status.panel")}</span>
          {trayOpen
            ? <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            : <ChevronUp className="w-3.5 h-3.5 shrink-0 group-hover:-translate-y-px transition-transform" />}
        </button>
      ) : <span className="pl-3" />}

      {/* Left Section: Document context & health (the "interior details"). */}
      <div className="flex items-center gap-3 min-w-0 px-2 overflow-hidden">
        {activeDoc && (
          <div className="hidden md:flex items-center gap-1.5 min-w-0 max-w-[220px]" title={activeDoc.title}>
            <FileText className="size-3 shrink-0 opacity-60" />
            <span className="truncate font-medium text-foreground/80">{activeDoc.title}</span>
          </div>
        )}

        {/* Current view mode — quick orientation for split/single-pane. */}
        <span className="hidden lg:inline whitespace-nowrap" title={t("status.currentViewMode")}>
          {MODE_LABEL[mode] ?? mode}{readOnly ? t("status.readOnlySuffix") : ""}
        </span>

        {fidelityBadge && (
          <div
            className="flex items-center gap-1 text-amber-800 dark:text-amber-500 font-medium"
            /* Plain language, not schema vocabulary: this badge is the only
               warning a user gets before an export drops the formatting. */
            title={t("status.fidelityLossTitle", { count: fidelityReport!.totalLossCount })}
          >
            <AlertTriangle className="size-3" />
            <span className="hidden sm:inline whitespace-nowrap">{fidelityBadge}</span>
          </div>
        )}

        {residualCount > 0 && (
          /* A button, not a label: the count alone told the reader that some
             number of elements "could not be mapped to the current schema" and
             gave them no way to find out which — in an editor whose promise is
             that it does not quietly change your document. */
          <button
            onClick={() => setShowResiduals(true)}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 pointer-coarse:py-1.5 text-amber-800 dark:text-amber-500 transition-colors hover:bg-accent hover:text-foreground"
            title={t("status.residualsTitle", { count: residualCount })}
          >
            <AlertCircle className="size-3" />
            <span className="hidden sm:inline whitespace-nowrap">{t("status.residualCount", { count: residualCount })}</span>
          </button>
        )}

        {hasLinks && (
          <button
            onClick={onToggleLinks}
            aria-pressed={linksActive}
            className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 pointer-coarse:py-1.5 transition-colors ${
              linksActive ? "bg-primary/10 text-primary-strong" : "text-blue-700 dark:text-blue-400 hover:bg-accent hover:text-foreground"
            }`}
            title={t("status.linksChipTitle")}
          >
            <LinkIcon className="size-3 shrink-0" />
            <span className="whitespace-nowrap">
              {t("status.linkCount", { count: linkCount })}{activeUnresolved.length > 0 ? t("status.brokenSuffix", { count: activeUnresolved.length }) : ""}
            </span>
          </button>
        )}
      </div>

      {/* The one live region. Visually hidden, because what it SAYS is not
          what the block below SHOWS: only failures and recovery are spoken. */}
      <span role="status" aria-live="polite" className="sr-only">
        <span key={announcement.seq}>{announcement.text}</span>
      </span>

      {/* Center Section: Sync/Save State. Deliberately NOT a live region any
          more — it walks editing → saving → saved on every autosave, and
          announcing that cycle interrupted a screen-reader user several times
          a minute while they typed (A096). */}
      <div
        className="flex-1 inline-flex items-center justify-center pointer-events-none px-2"
      >
        {/* "Unsaved changes" and "Save failed" keep their text at every width —
            they're the states a user most needs to notice on a phone. */}
        {saveStatus === "editing" && saveError && (
          // A failed autosave is routed error → editing after 3s so the retry
          // effect re-arms, so for most of each retry cycle this bar used to
          // read "Unsaved changes" — the reassuring message — while saving was
          // in fact failing over and over.
          <div
            className="flex items-center gap-1.5 text-destructive font-bold whitespace-nowrap"
            title={t("status.saveFailedTitle", { error: saveError })}
          >
            <AlertCircle className="size-3 shrink-0" />
            <span className="hidden sm:inline">{t("status.saveFailedRetrying")}</span>
            <span className="sm:hidden">{t("status.saveFailed")}</span>
          </div>
        )}
        {saveStatus === "editing" && !saveError && (
          <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-500 font-medium whitespace-nowrap">
            <PenLine className="size-3" />
            <span>{t("status.unsavedChanges")}</span>
          </div>
        )}
        {saveStatus === "saving" && (
          <div className="flex items-center gap-1.5 text-primary-strong animate-pulse">
            <Loader2 className="size-3 animate-spin" />
            <span className="hidden xs:inline font-medium tracking-tight">{t("status.saving")}</span>
          </div>
        )}
        {saveStatus === "saved" && (
          <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-500 font-medium">
            <CheckCircle2 className="size-3" />
            <span className="hidden xs:inline">{t("status.changesSaved")}</span>
          </div>
        )}
        {saveStatus === "error" && (
          <div className="flex items-center gap-1.5 text-destructive font-bold whitespace-nowrap">
            <AlertCircle className="size-3" />
            <span>{t("status.saveFailed")}</span>
          </div>
        )}
        {saveStatus === "blocked" && saveError !== SCHEMA_LOCK_ERROR && (
          // TERMINAL: the data-loss backstop refused to write a blank editor
          // over a document that has content. Autosave deliberately does not
          // re-arm, so without a branch here the state was invisible except for
          // one 30s-throttled toast.
          <div
            className="flex items-center gap-1.5 text-destructive font-bold whitespace-nowrap"
            title={t("status.blockedTitle")}
          >
            <AlertTriangle className="size-3 shrink-0" />
            <span className="hidden sm:inline">{t("status.emptyEditorNotSaving")}</span>
            <span className="sm:hidden">{t("status.notSaving")}</span>
          </div>
        )}
        {saveStatus === "blocked" && saveError === SCHEMA_LOCK_ERROR && (
          // TERMINAL: a document from a newer build, shown read-only as a
          // best-effort copy. Saving it would replace the real content.
          <div
            className="flex items-center gap-1.5 text-destructive font-bold whitespace-nowrap"
            title={t("status.schemaLockTitle")}
          >
            <AlertTriangle className="size-3 shrink-0" />
            <span className="hidden sm:inline">{t("status.newerVersionReadOnly")}</span>
            <span className="sm:hidden">{t("status.readOnly")}</span>
          </div>
        )}
        {saveStatus === "full" && (
          // TERMINAL: storage is out of room. The old "Save failed — retrying"
          // retried forever and said nothing about what would help.
          <div
            className="flex items-center gap-1.5 text-destructive font-bold whitespace-nowrap"
            title={t("status.storageFullTitle")}
          >
            <AlertTriangle className="size-3 shrink-0" />
            <span className="hidden sm:inline">{t("status.storageFullNotSaving")}</span>
            <span className="sm:hidden">{t("status.storageFull")}</span>
          </div>
        )}
        {saveStatus === "conflict" && (
          <div
            className="flex items-center gap-1.5 text-destructive font-bold whitespace-nowrap"
            title={t("status.conflictTitle")}
          >
            <AlertTriangle className="size-3 shrink-0" />
            <span className="hidden sm:inline">{t("status.conflictNotSaving")}</span>
            <span className="sm:hidden">{t("status.tabConflict")}</span>
          </div>
        )}
      </div>

      {/* Right Section: Analytics & View Actions */}
      <div className="flex items-center gap-3 px-2">
        {showStorage && (
          <div
            className={`flex items-center gap-1 font-medium tabular-nums ${storageCritical ? "text-destructive" : "text-amber-800 dark:text-amber-500"}`}
            title={t("status.storageTitle", { pct: storagePct, used: (storageMetrics!.usedBytes / (1024 * 1024)).toFixed(1), max: (storageMetrics!.maxBytes / (1024 * 1024)).toFixed(0) })}
          >
            <HardDrive className="size-3" />
            <span className="whitespace-nowrap">{storagePct}%</span>
          </div>
        )}

        <div className="hidden sm:flex items-center gap-3 pr-3 border-r border-border/50 font-medium tabular-nums">
          <span title={t("status.totalWords")}>{t("status.wordCountShort", { count: wordCount })}</span>
          <span className="hidden md:inline" title={t("status.totalCharacters")}>{t("status.charCountShort", { count: charCount })}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowShortcuts(true)}
            className="hidden sm:inline-flex p-1 rounded-md transition-all hover:bg-accent hover:text-foreground active:scale-95"
            title={t("status.keyboardShortcuts")}
            aria-label={t("status.keyboardShortcuts")}
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>

          {onOpenMemory && (
            <button
              onClick={onOpenMemory}
              className={`hidden sm:flex items-center gap-1 rounded-md p-1 transition-all hover:bg-accent active:scale-95 ${
                memPct >= 100 ? "text-destructive" : memPct >= 75 ? "text-amber-800 dark:text-amber-500" : "hover:text-foreground"
              }`}
              title={t("status.memoryTitle", { used: formatEstBytes(memStats.totalEstBytes), budget: formatEstBytes(memStats.budgetBytes) })}
              aria-label={t("status.memoryAndUndoHistory")}
            >
              <MemoryStick className="h-3.5 w-3.5" />
              {memStats.enabled && memStats.entryCount > 0 && (
                <span className="hidden font-mono text-[10px] tabular-nums md:inline">
                  {formatEstBytes(memStats.totalEstBytes)}
                </span>
              )}
            </button>
          )}
        </div>
      </div>
      <KeyboardShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <ResidualsDialog
        open={showResiduals}
        onClose={() => setShowResiduals(false)}
        residuals={activeDoc?.residuals ?? []}
        docTitle={activeDoc?.title}
      />
    </footer>
  );
}

export const StatusBar = React.memo(RawStatusBar);
