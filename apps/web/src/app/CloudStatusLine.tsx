import { AlertTriangle, CloudCheck, CloudOff, Loader2, Lock } from "lucide-react";
import { useT } from "../i18n";
import { cn } from "@/lib/utils";
import { useCloudStatus, type CloudPhase } from "./cloud";

const ICON: Record<CloudPhase, React.ElementType> = {
  off: CloudOff,
  preparing: Loader2,
  syncing: Loader2,
  synced: CloudCheck,
  offline: CloudOff,
  error: AlertTriangle,
  blocked: Lock,
};

/** Where cloud sync stands, in one line (account menu, profile page). */
export function CloudStatusLine({ className }: { className?: string }) {
  const t = useT();
  const phase = useCloudStatus((s) => s.phase);
  const text = {
    off: t("account.syncOff"),
    preparing: t("account.bringingDocuments"),
    syncing: t("account.syncSyncing"),
    synced: t("account.syncSynced"),
    offline: t("account.syncOffline"),
    error: t("account.syncError"),
    blocked: t("account.syncBlocked"),
  }[phase];
  const Icon = ICON[phase];
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)} role="status" aria-label={`${t("account.syncLabel")}: ${text}`}>
      <Icon className={cn("mt-px size-3.5 shrink-0", (phase === "syncing" || phase === "preparing") && "animate-spin")} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
