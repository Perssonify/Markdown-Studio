import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArchiveRestore, DownloadCloud, ExternalLink, History, Smartphone, X } from "lucide-react";
import React, { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { APP_DOMAIN, APP_NAME, APP_URL } from "../constants";
import { useDocumentStore } from "../store/documentStore";
import { snapshotStore } from "../store/snapshot-store";
import {
  acknowledgeWipe,
  backupNudgeDue,
  backupNudgeInput,
  daysAgoLabel,
  getDurabilitySnapshot,
  installTipDue,
  isAppleMobile,
  isInstalledApp,
  isLegacyOrigin,
  isSevenDayCapBrowser,
  pickDurabilityNotice,
  readInstallTipSnooze,
  readLastBackup,
  readPersistenceStatus,
  snoozeBackupNudge,
  snoozeInstallTip,
  startDurabilityWatch,
  storagePersists,
  subscribeDurability,
} from "../store/storage-durability";

export interface DurabilityNoticesProps {
  /**
   * The standalone app's own notices: the backup reminder, the wiped-library
   * explanation, the moved-domain banner and the Safari install tip. An
   * embedder's storage is the embedder's business, so only the app sets this.
   */
  appNotices: boolean;
  /**
   * Probe whether saving works. False when a host injected its own adapter —
   * a deliberately in-memory adapter is the host's choice, not a fault.
   */
  checkStorage: boolean;
  /** Run the full, restorable backup (File ▸ Export ▸ Full backup). */
  onBackup: () => void;
  /** Import files — the same path as dropping them on the editor. */
  onImportFiles: (files: FileList) => void;
  onOpenVersionHistory: () => void;
}

type Tone = "critical" | "warning" | "info";

const TONE: Record<Tone, string> = {
  critical: "border-destructive/40 bg-destructive/10",
  warning: "border-amber-500/40 bg-amber-500/10",
  info: "border-border bg-muted/60",
};
const ICON_TONE: Record<Tone, string> = {
  critical: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-primary",
};

/** One slim strip in the flow above the status bar — never a modal, never over the text. */
function Strip({
  tone,
  icon: Icon,
  role,
  label,
  children,
  actions,
}: {
  tone: Tone;
  icon: React.ElementType;
  role: "alert" | "status";
  label: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      role={role}
      aria-label={label}
      data-durability-notice={label}
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-3 py-1.5 text-xs text-foreground",
        TONE[tone],
      )}
    >
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", ICON_TONE[tone])} aria-hidden />
        <div className="min-w-0 leading-snug">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

const btn = "h-7 gap-1 px-2.5 text-xs pointer-coarse:h-9";

function Dismiss({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-7 text-muted-foreground hover:text-foreground pointer-coarse:size-9"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <X className="size-3.5" />
    </Button>
  );
}

/**
 * Storage-durability notices (production-readiness audit A017 / A022 / A004).
 * Chooses at most one notice via `pickDurabilityNotice`; see
 * `store/storage-durability.ts` for what each protects against.
 */
function DurabilityNoticesInner({
  appNotices,
  checkStorage,
  onBackup,
  onImportFiles,
  onOpenVersionHistory,
}: DurabilityNoticesProps) {
  const docCount = useDocumentStore((s) => s.documents.length);
  const durability = useSyncExternalStore(subscribeDurability, getDurabilitySnapshot, getDurabilitySnapshot);
  const fileRef = useRef<HTMLInputElement>(null);

  // A022 — does saving work at all here?
  const [storageOk, setStorageOk] = useState(true);
  useEffect(() => {
    if (!checkStorage) return;
    let alive = true;
    void storagePersists(useDocumentStore.getState().getStorage()).then((ok) => {
      if (alive) setStorageOk(ok);
    });
    return () => { alive = false; };
  }, [checkStorage]);

  // A017 — keep the canary current; ask for persistence after the first save.
  useEffect(() => (appNotices ? startDurabilityWatch(useDocumentStore) : undefined), [appNotices]);

  // Persistence state, for the install tip (a granted request already protects
  // the data). Re-read when durability state moves (the watcher's request).
  const [persisted, setPersisted] = useState<boolean | null>(null);
  useEffect(() => {
    if (!appNotices) return;
    let alive = true;
    void readPersistenceStatus().then((s) => { if (alive) setPersisted(s.persisted); });
    return () => { alive = false; };
  }, [appNotices, durability.revision]);

  // Whether Version history holds anything worth pointing a wiped user at.
  const [hasSnapshots, setHasSnapshots] = useState(false);
  useEffect(() => {
    if (!durability.wipe) return;
    let alive = true;
    void snapshotStore.listAll().then((m) => { if (alive) setHasSnapshots(m.size > 0); }).catch(() => {});
    return () => { alive = false; };
  }, [durability.wipe]);

  const [movedDismissed, setMovedDismissed] = useState(false);

  const now = Date.now();
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const touch = typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;
  const hostname = typeof window !== "undefined" ? window.location.hostname : "";
  const lastBackup = readLastBackup();

  const notice = pickDurabilityNotice({
    storageOk,
    appNotices,
    wiped: !!durability.wipe,
    legacyOrigin: isLegacyOrigin(hostname),
    movedDismissed,
    backupDue: appNotices && backupNudgeDue(backupNudgeInput(docCount, now)),
    installDue:
      appNotices &&
      installTipDue({
        sevenDayCap: isSevenDayCapBrowser(ua, touch),
        installed: isInstalledApp(),
        persisted,
        docCount,
        snoozedUntil: readInstallTipSnooze(),
        now,
      }),
  });

  if (!notice) return null;

  if (notice === "unavailable") {
    // Persistent and not dismissable: it stays true for as long as this tab
    // lives, and closing the tab is exactly when it matters.
    return (
      <Strip tone="critical" icon={AlertTriangle} role="alert" label="Not saving">
        <strong className="font-semibold">Not saving — browser storage is unavailable in this window.</strong>{" "}
        <span className="text-muted-foreground">
          This happens in some private windows and when a browser blocks site data. Your writing stays on
          screen until you close the tab — use File ▸ Export to keep a copy.
        </span>
      </Strip>
    );
  }

  if (notice === "wiped" && durability.wipe) {
    const { expectedCount, lastSeenAt } = durability.wipe;
    return (
      <Strip
        tone="warning"
        icon={AlertTriangle}
        role="status"
        label="Library cleared"
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,.json,.md,.markdown,.txt,.html,.htm,.docx,.tar,.gz,.tgz"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onImportFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="outline" className={btn} onClick={() => fileRef.current?.click()}>
              <ArchiveRestore className="size-3.5" /> Import a backup…
            </Button>
            {hasSnapshots && (
              <Button size="sm" variant="outline" className={btn} onClick={onOpenVersionHistory}>
                <History className="size-3.5" /> Version history
              </Button>
            )}
            <Button size="sm" variant="ghost" className={btn} onClick={() => acknowledgeWipe()}>
              Start fresh
            </Button>
          </>
        }
      >
        <strong className="font-semibold">Your library here is empty.</strong>{" "}
        <span className="text-muted-foreground">
          This browser held {expectedCount} document{expectedCount === 1 ? "" : "s"} on this site
          {lastSeenAt ? ` (${daysAgoLabel(lastSeenAt, now)})` : ""}, so its storage appears to have been
          cleared — browsers do this after a long gap between visits, when disk space runs low, or when site
          data is deleted. Restore a full backup (.zip) if you have one
          {hasSnapshots ? ", or look in Version history" : ""}.
        </span>
      </Strip>
    );
  }

  if (notice === "moved") {
    return (
      <Strip
        tone="warning"
        icon={DownloadCloud}
        role="status"
        label={`${APP_NAME} has moved`}
        actions={
          <>
            <Button size="sm" variant={lastBackup ? "outline" : "default"} className={btn} onClick={onBackup}>
              <DownloadCloud className="size-3.5" /> {lastBackup ? "Download again" : "Download backup"}
            </Button>
            <a
              href={APP_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ size: "sm", variant: lastBackup ? "default" : "outline" }), btn)}
            >
              Open {APP_DOMAIN} <ExternalLink className="size-3" />
            </a>
            <Dismiss onClick={() => setMovedDismissed(true)} label="Hide for now" />
          </>
        }
      >
        <strong className="font-semibold">{APP_NAME} has moved to {APP_DOMAIN}.</strong>{" "}
        <span className="text-muted-foreground">
          {lastBackup
            ? `You downloaded a full backup ${daysAgoLabel(lastBackup, now)}. Now open ${APP_DOMAIN} and import it there (File ▸ Open file…).`
            : `Your documents are stored in this browser for this address only — download a full backup, then import it at ${APP_DOMAIN} (File ▸ Open file…).`}
        </span>
      </Strip>
    );
  }

  if (notice === "backup") {
    return (
      <Strip
        tone="info"
        icon={DownloadCloud}
        role="status"
        label="Backup reminder"
        actions={
          <>
            <Button size="sm" variant="outline" className={btn} onClick={onBackup}>
              <DownloadCloud className="size-3.5" /> Download backup
            </Button>
            <Button size="sm" variant="ghost" className={btn} onClick={() => snoozeBackupNudge()}>
              Not now
            </Button>
          </>
        }
      >
        <strong className="font-semibold">
          {lastBackup ? `Last full backup: ${daysAgoLabel(lastBackup, now)}.` : "No full backup yet."}
        </strong>{" "}
        <span className="text-muted-foreground">
          Your documents live only in this browser. A backup (.zip) restores your whole library, folders
          included, in any browser.
        </span>
      </Strip>
    );
  }

  // notice === "install"
  const mobile = isAppleMobile(ua, touch);
  return (
    <Strip
      tone="info"
      icon={Smartphone}
      role="status"
      label="Keep your library"
      actions={
        <Button size="sm" variant="ghost" className={btn} onClick={() => snoozeInstallTip()}>
          Got it
        </Button>
      }
    >
      <strong className="font-semibold">Safari may delete this site's data after 7 days without a visit.</strong>{" "}
      <span className="text-muted-foreground">
        {mobile
          ? `To keep your library, add ${APP_NAME} to your Home Screen (Share ▸ Add to Home Screen) and keep a backup.`
          : `To keep your library, add ${APP_NAME} to your Dock (File ▸ Add to Dock) and keep a backup.`}
      </span>
    </Strip>
  );
}

// Memoized with stable props from PerssonifyEditor, like the rest of the chrome.
export const DurabilityNotices = React.memo(DurabilityNoticesInner);
