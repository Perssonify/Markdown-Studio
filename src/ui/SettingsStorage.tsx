import { Button } from "@/components/ui/button";
import { DownloadCloud, ImageMinus, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { cleanUpUnusedAssets, findUnusedAssets } from "../store/asset-gc";
import { assetStore } from "../store/asset-store";
import { useDocumentStore } from "../store/documentStore";
import { useDialog } from "./DialogProvider";
import {
  daysAgoLabel,
  getDurabilitySnapshot,
  readLastBackup,
  readPersistenceStatus,
  requestPersistence,
  storagePersists,
  subscribeDurability,
  type PersistenceStatus,
} from "../store/storage-durability";
import { t, useT } from "../i18n";

export function formatStorageBytes(n: number): string {
  if (n < 1024) return t("settings.sizeBytes", { count: n });
  if (n < 1024 * 1024) return t("settings.sizeKb", { count: Math.round(n / 1024) });
  if (n < 1024 * 1024 * 1024) return t("settings.sizeMb", { count: (n / (1024 * 1024)).toFixed(1) });
  return t("settings.sizeGb", { count: (n / (1024 * 1024 * 1024)).toFixed(1) });
}


/**
 * Images stored as assets (A086): how many and how big, and the ONE way they
 * are ever deleted while documents exist — an explicit clean-up that scans
 * every place a reference can live first (asset-gc.ts). Nothing is collected
 * automatically during editing. Rendered by the Settings sheet right after
 * the storage section (it needs the app's dialog provider for its confirm).
 */
export function StoredImagesSection({ open }: { open: boolean }) {
  const { confirm } = useDialog();
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ok = await assetStore.available();
    setAvailable(ok);
    setStats(ok ? await assetStore.stats() : null);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
    return assetStore.subscribe(() => { void refresh(); });
  }, [open, refresh]);

  const cleanUp = async () => {
    setBusy(true);
    try {
      const report = await findUnusedAssets();
      if (!report.unused.length) {
        toast.info(report.recent ? t("settings.imagesNoneRecent", { count: report.recent }) : t("settings.imagesNone"));
        return;
      }
      const ok = await confirm({
        title: t("settings.imagesConfirmTitle", { count: report.unused.length }),
        description: t("settings.imagesConfirmDesc", { size: formatStorageBytes(report.unusedBytes) }),
        confirmLabel: t("settings.imagesConfirmLabel"),
        destructive: true,
      });
      if (!ok) return;
      const done = await cleanUpUnusedAssets();
      toast.success(t("settings.imagesDeleted", { count: done.deleted, size: formatStorageBytes(done.freedBytes) }));
      useDocumentStore.getState().storageFreed();
    } catch {
      toast.error(t("settings.imagesFailed"));
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  return (
    <div className="space-y-1.5" aria-label={t("settings.storedImages")} role="group">
      <p className="text-sm">{t("settings.imagesHeading")}</p>
      <p className="text-xs text-muted-foreground" data-testid="stored-images">
        {available === false
          ? t("settings.imagesInline")
          : stats
            ? t("settings.imagesSummary", { count: stats.count, size: formatStorageBytes(stats.bytes) })
            : t("settings.imagesChecking")}
      </p>
      {available && (
        <Button size="sm" variant="outline" className="h-7 gap-1 text-xs pointer-coarse:h-9" disabled={busy} onClick={() => void cleanUp()}>
          <ImageMinus className="size-3.5" /> {t("settings.imagesCleanUp")}
        </Button>
      )}
    </div>
  );
}

/**
 * Settings ▸ Storage & backup (A017 / A022): is this library being kept, how
 * much room it takes, and when it was last backed up — the three things that
 * decide whether a browser clean-up costs the user their work.
 */
export function StorageBackupSection({ open, onBackup }: { open: boolean; onBackup?: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<PersistenceStatus | null>(null);
  const [storageOk, setStorageOk] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);
  // Re-renders when a backup is recorded (or a persistence request lands).
  const durability = useSyncExternalStore(subscribeDurability, getDurabilitySnapshot, getDurabilitySnapshot);

  const refresh = useCallback(async () => {
    const [s, ok] = await Promise.all([
      readPersistenceStatus(),
      storagePersists(useDocumentStore.getState().getStorage()),
    ]);
    setStatus(s);
    setStorageOk(ok);
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh, durability.revision]);

  // A button press is a user gesture, so it may ask even inside the
  // automatic-request throttle (Firefox shows its prompt for exactly this).
  const ask = async () => {
    setAsking(true);
    try {
      await requestPersistence({ force: true });
      await refresh();
    } finally {
      setAsking(false);
    }
  };

  const lastBackup = readLastBackup();

  let persistence: string;
  if (!status) persistence = t("settings.persistenceChecking");
  else if (!status.supported) persistence = t("settings.persistenceUnsupported");
  else if (status.persisted) persistence = t("settings.persistenceOn");
  else persistence = t("settings.persistenceOff");

  return (
    <section className="space-y-3" aria-label={t("settings.storageAndBackupRegion")}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("settings.storageAndBackup")}</h3>
      {storageOk === false && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {t("settings.browserStorageIsUnavailableIn")}
        </p>
      )}
      <div className="space-y-1.5">
        <p className="text-sm">{t("settings.persistentStorage")}</p>
        <p className="text-xs text-muted-foreground" data-testid="persistence-status">{persistence}</p>
        {status?.supported && status.persisted === false && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs pointer-coarse:h-9" disabled={asking} onClick={() => void ask()}>
            <ShieldCheck className="size-3.5" /> {t("settings.askTheBrowserToKeep")}
          </Button>
        )}
        {status?.usage != null && (
          <p className="text-[11px] text-muted-foreground">
            {status.quota != null
              ? t("settings.storageUsingOfAbout", { used: formatStorageBytes(status.usage), quota: formatStorageBytes(status.quota) })
              : t("settings.storageUsing", { used: formatStorageBytes(status.usage) })}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-sm">{t("settings.lastFullBackup")}</p>
        <p className="text-xs text-muted-foreground" data-testid="last-backup">
          {lastBackup
            ? t("settings.lastBackupWhen", { ago: daysAgoLabel(lastBackup), date: new Date(lastBackup).toLocaleDateString() })
            : t("settings.neverAFullBackupZip")}
        </p>
        {onBackup && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs pointer-coarse:h-9" onClick={onBackup}>
            <DownloadCloud className="size-3.5" /> {t("settings.downloadFullBackup")}
          </Button>
        )}
      </div>
    </section>
  );
}
