import { Button } from "@/components/ui/button";
import { AlertCircle, Archive, Download, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocale, useT } from "@/i18n";
import { formatSnapshotBytes } from "@/store/history/snapshot-store";
import { browserNav } from "../account";
import { httpAccountArchive, type AccountArchiveApi, type BackupInfo } from "@/app/cloud/api";
import type { BackupOutcome } from "@/app/cloud/backup";

type Listing = { state: "loading" } | { state: "failed" } | { state: "ready"; backups: BackupInfo[] };

function formatDay(date: string, locale: string): string {
  const [y, m, d] = date.split("-").map(Number);
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(y!, m! - 1, d));
  } catch {
    return date;
  }
}

/**
 * The account's daily backups (profile page): each one downloads as the same
 * ZIP File ▸ Export ▸ Full backup makes, which File ▸ Import restores.
 */
export function AccountBackups({
  backUpNow,
  api = httpAccountArchive,
}: {
  /** Replace today's backup with the library as it is now. */
  backUpNow: () => Promise<BackupOutcome>;
  api?: Pick<AccountArchiveApi, "listBackups" | "backupDownloadUrl">;
}) {
  const t = useT();
  const locale = useLocale();
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const [working, setWorking] = useState<"backing-up" | string | null>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setListing({ state: "ready", backups: await api.listBackups() });
    } catch {
      setListing({ state: "failed" });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleBackUp = async () => {
    setWorking("backing-up");
    setMessage(null);
    try {
      const outcome = await backUpNow();
      if (outcome === "stored" || outcome === "exists") {
        setMessage({ error: false, text: t("account.backupStored") });
        await load();
      } else if (outcome === "empty") {
        setMessage({ error: false, text: t("account.backupEmpty") });
      } else {
        setMessage({ error: true, text: outcome === "too-large" ? t("account.backupTooLarge") : t("account.backupFailed") });
      }
    } catch {
      setMessage({ error: true, text: t("account.backupFailed") });
    } finally {
      setWorking(null);
    }
  };

  const handleDownload = async (date: string) => {
    setWorking(date);
    setMessage(null);
    try {
      // A short-lived link to the file in S3; it downloads (Content-Disposition)
      // and this page stays where it is.
      browserNav.go(await api.backupDownloadUrl(date));
    } catch {
      setMessage({ error: true, text: t("account.backupDownloadFailed") });
    } finally {
      setWorking(null);
    }
  };

  let list: React.ReactNode;
  if (listing.state === "loading") {
    list = <p className="py-3 text-center text-xs text-muted-foreground">{t("account.backupsLoading")}</p>;
  } else if (listing.state === "failed") {
    list = <p className="py-3 text-center text-xs text-muted-foreground">{t("account.backupsUnavailable")}</p>;
  } else if (listing.backups.length === 0) {
    list = <p className="py-3 text-center text-xs text-muted-foreground">{t("account.backupsNone")}</p>;
  } else {
    list = (
      <ul className="divide-y divide-border/60">
        {listing.backups.map((b) => (
          <li key={b.date} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{formatDay(b.date, locale)}</p>
              <p className="text-xs text-muted-foreground">{formatSnapshotBytes(b.size)}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1.5 text-xs"
              disabled={working != null}
              aria-label={t("account.downloadBackupOf", { date: formatDay(b.date, locale) })}
              onClick={() => void handleDownload(b.date)}
            >
              {working === b.date ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
              {t("account.download")}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="account-backups" className="mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 id="account-backups" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Archive className="size-5 text-primary" /> {t("account.backups")}
        </h2>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" disabled={working != null} onClick={() => void handleBackUp()}>
          {working === "backing-up" && <Loader2 className="size-3.5 animate-spin" />}
          {working === "backing-up" ? t("account.backingUp") : t("account.backUpNow")}
        </Button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("account.backupsHint")}</p>
      {message && (
        <p role={message.error ? "alert" : "status"} className={message.error ? "mt-2 flex items-start gap-1.5 text-xs text-destructive" : "mt-2 text-xs text-muted-foreground"}>
          {message.error && <AlertCircle className="mt-px size-3.5 shrink-0" />}
          <span>{message.text}</span>
        </p>
      )}
      <div className="mt-3 rounded-lg border border-border bg-card/40 px-4">{list}</div>
    </section>
  );
}
