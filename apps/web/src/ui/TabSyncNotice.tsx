import { Button } from "@/components/ui/button";
import { AlertTriangle, Copy, FilePlus2, FileX2, Undo2, X } from "lucide-react";
import { useDocumentStore } from "../store/documents/documentStore";
import { snapshotStore } from "../store/history/snapshot-store";
import { useTabSyncStore } from "../store/persistence/tab-sync";
import { useUIStore } from "../store/preferences/uiStore";
import { useT } from "../i18n";
import { NoticeStrip, noticeButton } from "./NoticeStrip";

/**
 * Another tab changed — or deleted — the document open here while this tab
 * holds work that is not saved (editor/useTabSync.ts). This tab has stopped
 * saving; the strip says why and offers the ways out. It stays until one is
 * taken or the document is left: dismissing it would leave a tab that silently
 * does not save.
 */
export function TabSyncNotice() {
  const t = useT();
  const notice = useTabSyncStore((s) => s.notice);
  const actions = useTabSyncStore((s) => s.actions);
  const busy = useTabSyncStore((s) => s.busy);
  const activeDocId = useDocumentStore((s) => s.activeDocId);
  const readOnly = useUIStore((s) => s.readOnly);

  if (!notice || !actions || notice.docId !== activeDocId) return null;

  if (notice.kind === "deleted") {
    return (
      <NoticeStrip
        tone="critical"
        icon={FileX2}
        role="alert"
        label={t("notices.tabDeletedLabel")}
        hook="Deleted in another tab"
        hookAttr="data-tab-sync-notice"
        actions={
          <>
            <Button size="sm" variant="default" className={noticeButton} disabled={busy} onClick={() => void actions.keepAsNew()}>
              <FilePlus2 className="size-3.5" /> {t("notices.tabKeepAsNew")}
            </Button>
            <Button size="sm" variant="ghost" className={noticeButton} disabled={busy} onClick={() => void actions.close()}>
              <X className="size-3.5" /> {t("notices.tabClose")}
            </Button>
          </>
        }
      >
        <strong className="font-semibold">{t("notices.tabDeletedHeadline")}</strong>{" "}
        <span className="text-muted-foreground">{t("notices.tabDeletedBody")}</span>
      </NoticeStrip>
    );
  }

  // "Keep mine" and "Use theirs" each set one version aside in Version
  // history. Where a host has turned history off, only the copy keeps both.
  const history = snapshotStore.isEnabled();
  return (
    <NoticeStrip
      tone="warning"
      icon={AlertTriangle}
      role="alert"
      label={t("notices.tabChangedLabel")}
      hook="Changed in another tab"
      hookAttr="data-tab-sync-notice"
      actions={
        <>
          {history && (
            <Button
              size="sm"
              variant="outline"
              className={noticeButton}
              disabled={busy || readOnly}
              title={readOnly ? t("notices.tabKeepMineReadOnly") : t("notices.tabKeepMineTitle")}
              onClick={() => void actions.keepMine()}
            >
              {t("notices.tabKeepMine")}
            </Button>
          )}
          {history && (
            <Button
              size="sm"
              variant="outline"
              className={noticeButton}
              disabled={busy}
              title={t("notices.tabUseTheirsTitle")}
              onClick={() => void actions.useTheirs()}
            >
              <Undo2 className="size-3.5" /> {t("notices.tabUseTheirs")}
            </Button>
          )}
          <Button
            size="sm"
            variant={history ? "ghost" : "default"}
            className={noticeButton}
            disabled={busy}
            title={t("notices.tabSaveCopyTitle")}
            onClick={() => void actions.saveCopy()}
          >
            <Copy className="size-3.5" /> {t("notices.tabSaveCopy")}
          </Button>
        </>
      }
    >
      <strong className="font-semibold">{t("notices.tabChangedHeadline")}</strong>{" "}
      <span className="text-muted-foreground">
        {history ? t("notices.tabChangedBody") : t("notices.tabChangedBodyNoHistory")}
      </span>
    </NoticeStrip>
  );
}
