import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearLocalData } from "../store/documents/documentStore";
import { useDialog } from "./DialogProvider";
import { useT } from "../i18n";

/**
 * Settings ▸ Local data ▸ Erase all local data.
 *
 * There was no way to remove the editor's data from a browser short of the
 * browser's own site-data controls: deleted documents lived on in version
 * history, and nothing cleared drafts, the crash stash or settings. This is
 * the "erase my data" control — confirmed first, because it cannot be undone.
 */
export function EraseLocalDataSection() {
  const t = useT();
  const { confirm } = useDialog();
  const [busy, setBusy] = useState(false);

  const erase = async () => {
    const ok = await confirm({
      title: t("settings.eraseConfirmTitle"),
      description: t("settings.eraseConfirmDesc"),
      confirmLabel: t("settings.eraseConfirmLabel"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clearLocalData({ preferences: true });
      toast.success(t("settings.eraseDone"));
    } catch {
      toast.error(t("settings.eraseFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("settings.localData")}
      </h3>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm">{t("settings.eraseAllLocalData")}</p>
          <p className="text-xs text-muted-foreground">
            {t("settings.eraseAllLocalDataDesc")}
          </p>
        </div>
        <Button variant="destructive" size="sm" disabled={busy} onClick={erase}>
          {t("settings.eraseButton")}
        </Button>
      </div>
    </section>
  );
}
