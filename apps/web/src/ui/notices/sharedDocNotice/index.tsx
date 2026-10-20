import { Button } from "@/components/ui/button";
import { Lock, Pencil, Radio, RadioTower } from "lucide-react";
import { useState } from "react";
import { useDocumentStore } from "@/store/documents/documentStore";
import { isReadOnlyShare, liveShareOf, ownCopyPatch } from "@/store/documents/live-share-meta";
import { timeAgo } from "@/ui/workspace/utils/relative-time";
import { useT } from "@/i18n";
import { NoticeStrip, noticeButton } from "../noticeStrip";

/**
 * The open document was shared with the user and opens read-only
 * (store/documents/live-share-meta.ts, editor/useSharedDocLock.ts): say why, and
 * offer the way to make it their own. A live copy says it is followed — its
 * owner's edits replace it — or that its owner stopped sharing it.
 */
export function SharedDocNotice() {
  const t = useT();
  const doc = useDocumentStore((s) => (s.activeDoc && s.hydratedDocId === s.activeDoc.id ? s.activeDoc : null));
  const [busy, setBusy] = useState(false);
  // "Stop following" asks first, in the strip itself (a two-step button): it
  // cannot be undone from here, and the strip lives outside any dialog host.
  const [confirming, setConfirming] = useState<string | null>(null);
  if (!doc) return null;
  const live = liveShareOf(doc.metadata);
  const readOnlyShare = isReadOnlyShare(doc.metadata);
  if (!live && !readOnlyShare) return null;

  const makeOwn = async () => {
    setBusy(true);
    try {
      // A real revision (not a metadata-only patch): it must reach the
      // account, or another device still following the note would push the
      // owner's next update back over this choice.
      await useDocumentStore.getState().patchDocById(doc.id, { metadata: ownCopyPatch() });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  if (live && !live.ended) {
    const asking = confirming === doc.id;
    return (
      <NoticeStrip
        tone={asking ? "warning" : "info"}
        icon={RadioTower}
        role="status"
        label={t("notices.liveLabel")}
        hook="Live shared document"
        hookAttr="data-shared-doc-notice"
        actions={
          asking ? (
            <>
              <Button size="sm" variant="default" className={noticeButton} disabled={busy} onClick={() => void makeOwn()}>
                <Pencil className="size-3.5" /> {t("notices.liveStop")}
              </Button>
              <Button size="sm" variant="ghost" className={noticeButton} disabled={busy} onClick={() => setConfirming(null)}>
                {t("common.cancel")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className={noticeButton} disabled={busy} onClick={() => setConfirming(doc.id)}>
              <Pencil className="size-3.5" /> {t("notices.liveStop")}
            </Button>
          )
        }
      >
        {asking ? (
          <>
            <strong className="font-semibold">{t("notices.liveStopConfirmTitle")}</strong>{" "}
            <span className="text-muted-foreground">{t("notices.liveStopConfirmBody")}</span>
          </>
        ) : (
          <>
            <strong className="font-semibold">{t("notices.liveHeadline")}</strong>{" "}
            <span className="text-muted-foreground">
              {live.at ? `${t("notices.liveUpdatedAt", { when: timeAgo(live.at) })} ` : ""}
              {t("notices.liveBody")}
            </span>
          </>
        )}
      </NoticeStrip>
    );
  }

  const ended = !!live?.ended;
  return (
    <NoticeStrip
      tone="info"
      icon={ended ? Radio : Lock}
      role="status"
      label={ended ? t("notices.liveEndedLabel") : t("notices.readOnlyShareLabel")}
      hook={ended ? "No longer shared" : "Shared read-only"}
      hookAttr="data-shared-doc-notice"
      actions={
        <Button size="sm" variant="default" className={noticeButton} disabled={busy} onClick={() => void makeOwn()}>
          {ended ? t("notices.liveEndedDismiss") : <><Pencil className="size-3.5" /> {t("notices.makeEditable")}</>}
        </Button>
      }
    >
      <strong className="font-semibold">{ended ? t("notices.liveEndedHeadline") : t("notices.readOnlyShareHeadline")}</strong>{" "}
      <span className="text-muted-foreground">{ended ? t("notices.liveEndedBody") : t("notices.readOnlyShareBody")}</span>
    </NoticeStrip>
  );
}
