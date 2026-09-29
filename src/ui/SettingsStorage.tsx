import { Button } from "@/components/ui/button";
import { DownloadCloud, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useDocumentStore } from "../store/documentStore";
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

export function formatStorageBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Settings ▸ Storage & backup (A017 / A022): is this library being kept, how
 * much room it takes, and when it was last backed up — the three things that
 * decide whether a browser clean-up costs the user their work.
 */
export function StorageBackupSection({ open, onBackup }: { open: boolean; onBackup?: () => void }) {
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
  if (!status) persistence = "Checking…";
  else if (!status.supported) persistence = "Not supported by this browser — it decides on its own when to clear site data.";
  else if (status.persisted) persistence = "On — this browser has agreed to keep your library when it clears space.";
  else persistence = "Off — this browser may clear your library when space runs low or after a long gap between visits.";

  return (
    <section className="space-y-3" aria-label="Storage and backup">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Storage &amp; backup</h3>
      {storageOk === false && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Browser storage is unavailable in this window — nothing is being saved. Use File ▸ Export to keep a copy.
        </p>
      )}
      <div className="space-y-1.5">
        <p className="text-sm">Persistent storage</p>
        <p className="text-xs text-muted-foreground" data-testid="persistence-status">{persistence}</p>
        {status?.supported && status.persisted === false && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs pointer-coarse:h-9" disabled={asking} onClick={() => void ask()}>
            <ShieldCheck className="size-3.5" /> Ask the browser to keep it
          </Button>
        )}
        {status?.usage != null && (
          <p className="text-[11px] text-muted-foreground">
            Using {formatStorageBytes(status.usage)}
            {status.quota != null ? ` of about ${formatStorageBytes(status.quota)} this browser allows for this site` : ""}.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <p className="text-sm">Last full backup</p>
        <p className="text-xs text-muted-foreground" data-testid="last-backup">
          {lastBackup
            ? `${daysAgoLabel(lastBackup)} (${new Date(lastBackup).toLocaleDateString()})`
            : "Never. A full backup (.zip) restores your whole library, folders included, in any browser."}
        </p>
        {onBackup && (
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs pointer-coarse:h-9" onClick={onBackup}>
            <DownloadCloud className="size-3.5" /> Download full backup
          </Button>
        )}
      </div>
    </section>
  );
}
