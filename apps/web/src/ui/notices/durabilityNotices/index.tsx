import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArchiveRestore, DownloadCloud, ExternalLink, History, Smartphone } from "lucide-react";
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NoticeDismiss as Dismiss, NoticeStrip as Strip, noticeButton as btn } from "../noticeStrip";
import { TabSyncNotice } from "../tabSyncNotice";
import { APP_DOMAIN, APP_NAME, APP_URL } from "@/constants";
import { useDocumentStore } from "@/store/documents/documentStore";
import { snapshotStore } from "@/store/history/snapshot-store";
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
} from "@/store/persistence/storage-durability";
import { useT } from "@/i18n";

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

/**
 * The strip area above the status bar: another tab changing or deleting the
 * open document (TabSyncNotice — it needs a choice, so it comes first), then
 * at most one storage-durability notice.
 */
function DurabilityNoticesInner(props: DurabilityNoticesProps) {
  return (
    <>
      <TabSyncNotice />
      <StorageNotice {...props} />
    </>
  );
}

/**
 * Storage-durability notices (production-readiness audit A017 / A022 / A004).
 * Chooses at most one notice via `pickDurabilityNotice`; see
 * `store/persistence/storage-durability.ts` for what each protects against.
 */
function StorageNotice({
  appNotices,
  checkStorage,
  onBackup,
  onImportFiles,
  onOpenVersionHistory,
}: DurabilityNoticesProps) {
  const t = useT();
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
      <Strip tone="critical" icon={AlertTriangle} role="alert" label={t("notices.notSaving")} hook="Not saving">
        <strong className="font-semibold">{t("notices.notSavingBrowserStorageIs")}</strong>{" "}
        <span className="text-muted-foreground">
          {t("notices.thisHappensInSomePrivate")}
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
        label={t("notices.libraryCleared")}
        hook="Library cleared"
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
              <ArchiveRestore className="size-3.5" /> {t("notices.importABackup")}
            </Button>
            {hasSnapshots && (
              <Button size="sm" variant="outline" className={btn} onClick={onOpenVersionHistory}>
                <History className="size-3.5" /> {t("notices.versionHistory")}
              </Button>
            )}
            <Button size="sm" variant="ghost" className={btn} onClick={() => acknowledgeWipe()}>
              {t("notices.startFresh")}
            </Button>
          </>
        }
      >
        <strong className="font-semibold">{t("notices.yourLibraryHereIsEmpty")}</strong>{" "}
        <span className="text-muted-foreground">
          {lastSeenAt
            ? t("notices.wipedHeldDocumentsAgo", { count: expectedCount, ago: daysAgoLabel(lastSeenAt, now) })
            : t("notices.wipedHeldDocuments", { count: expectedCount })}{" "}
          {hasSnapshots ? t("notices.wipedRestoreBackupOrHistory") : t("notices.wipedRestoreBackup")}
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
        label={t("notices.appHasMoved", { app: APP_NAME })}
        hook={`${APP_NAME} has moved`}
        actions={
          <>
            <Button size="sm" variant={lastBackup ? "outline" : "default"} className={btn} onClick={onBackup}>
              <DownloadCloud className="size-3.5" /> {lastBackup ? t("notices.downloadAgain") : t("notices.downloadBackup")}
            </Button>
            <a
              href={APP_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ size: "sm", variant: lastBackup ? "default" : "outline" }), btn)}
            >
              {t("notices.openDomain", { domain: APP_DOMAIN })} <ExternalLink className="size-3" />
            </a>
            <Dismiss onClick={() => setMovedDismissed(true)} label={t("notices.hideForNow")} />
          </>
        }
      >
        <strong className="font-semibold">{t("notices.appHasMovedTo", { app: APP_NAME, domain: APP_DOMAIN })}</strong>{" "}
        <span className="text-muted-foreground">
          {lastBackup
            ? t("notices.movedBackedUp", { ago: daysAgoLabel(lastBackup, now), domain: APP_DOMAIN })
            : t("notices.movedNotBackedUp", { domain: APP_DOMAIN })}
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
        label={t("notices.backupReminder")}
        hook="Backup reminder"
        actions={
          <>
            <Button size="sm" variant="outline" className={btn} onClick={onBackup}>
              <DownloadCloud className="size-3.5" /> {t("notices.downloadBackup")}
            </Button>
            <Button size="sm" variant="ghost" className={btn} onClick={() => snoozeBackupNudge()}>
              {t("notices.notNow")}
            </Button>
          </>
        }
      >
        <strong className="font-semibold">
          {lastBackup ? t("notices.lastFullBackup", { ago: daysAgoLabel(lastBackup, now) }) : t("notices.noFullBackupYet")}
        </strong>{" "}
        <span className="text-muted-foreground">
          {t("notices.yourDocumentsLiveOnlyIn")}
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
      label={t("notices.keepYourLibrary")}
      hook="Keep your library"
      actions={
        <Button size="sm" variant="ghost" className={btn} onClick={() => snoozeInstallTip()}>
          {t("notices.gotIt")}
        </Button>
      }
    >
      <strong className="font-semibold">{t("notices.safariMayDeleteThisSite")}</strong>{" "}
      <span className="text-muted-foreground">
        {mobile
          ? t("notices.installTipMobile", { app: APP_NAME })
          : t("notices.installTipDesktop", { app: APP_NAME })}
      </span>
    </Strip>
  );
}

// Memoized with stable props from PerssonifyEditor, like the rest of the chrome.
export const DurabilityNotices = React.memo(DurabilityNoticesInner);
