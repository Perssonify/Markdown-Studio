import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { clearLocalData } from "../store/documentStore";
import { useDialog } from "./DialogProvider";

/**
 * Settings ▸ Local data ▸ Erase all local data.
 *
 * There was no way to remove the editor's data from a browser short of the
 * browser's own site-data controls: deleted documents lived on in version
 * history, and nothing cleared drafts, the crash stash or settings. This is
 * the "erase my data" control — confirmed first, because it cannot be undone.
 */
export function EraseLocalDataSection() {
  const { confirm } = useDialog();
  const [busy, setBusy] = useState(false);

  const erase = async () => {
    const ok = await confirm({
      title: "Erase all local data?",
      description:
        "Deletes every document, all version history, unsaved drafts and this app's settings from this browser. " +
        "It cannot be undone — export a backup first if you might need anything.",
      confirmLabel: "Erase everything",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await clearLocalData({ preferences: true });
      toast.success("All local data erased from this browser");
    } catch {
      toast.error("Some data could not be erased");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Local data
      </h3>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm">Erase all local data</p>
          <p className="text-xs text-muted-foreground">
            Every document, all version history and unsaved drafts, and these settings — from this browser only.
          </p>
        </div>
        <Button variant="destructive" size="sm" disabled={busy} onClick={erase}>
          Erase…
        </Button>
      </div>
    </section>
  );
}
