import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LiveShares } from "@/editor/props";
import type { ShareLinkOptions } from "@/editor/useExportActions";
import type { Toast } from "@/editor/types";
import type { ShareView } from "@/store/importExport/share-link";
import { useT } from "@/i18n";
import { Copy, Lock, Pencil, RadioTower } from "lucide-react";
import { type ElementType, useEffect, useState } from "react";

export interface ShareTarget {
  kind: "doc" | "folder";
  id: string;
  name: string;
}

type Access = "copy" | "readOnly" | "live";

/**
 * Share a document or a folder: choose the layout it opens in (Split, the
 * default; Markdown; HTML) and what the recipient gets —
 *
 *  - an editable copy (the content travels inside the link: no server),
 *  - a read-only copy (the same, opening read-only until they make it theirs),
 *  - a LIVE read-only copy (a document only, when the host offers it): the
 *    link names a copy kept on the account's server, people who open it follow
 *    it, and the owner's edits reach them (app/publish).
 *
 * The link is copied when the user asks; nothing is published before that.
 */
export function ShareDialog({
  target,
  onClose,
  onShareDoc,
  onShareFolder,
  liveShares,
  toast,
}: {
  target: ShareTarget | null;
  onClose: () => void;
  onShareDoc: (docId: string, opts: ShareLinkOptions) => Promise<boolean>;
  onShareFolder: (folderId: string, opts: ShareLinkOptions) => Promise<boolean>;
  liveShares?: LiveShares;
  toast: Toast;
}) {
  const t = useT();
  const [view, setView] = useState<ShareView>("split");
  const [access, setAccess] = useState<Access>("copy");
  const [busy, setBusy] = useState(false);
  const [liveLink, setLiveLink] = useState<string | null>(null);
  const liveAvailable = !!liveShares && target?.kind === "doc";

  // Each opening starts from the defaults — unless the document is already
  // shared live, which is then what the dialog shows.
  useEffect(() => {
    if (!target) return;
    const link = target.kind === "doc" ? liveShares?.linkFor(target.id) ?? null : null;
    setLiveLink(link);
    setView("split");
    setAccess(link ? "live" : "copy");
    setBusy(false);
  }, [target, liveShares]);

  const shownLink = liveLink && target?.kind === "doc" ? liveShares?.linkFor(target.id, view) ?? liveLink : liveLink;
  // The live copy has fallen behind the note (it grew too large to publish).
  const problem = liveLink && target?.kind === "doc" ? liveShares?.problemFor?.(target.id) ?? null : null;

  const copy = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      if (access === "live" && liveShares && target.kind === "doc") {
        let link: string;
        try {
          link = await liveShares.publish(target.id, view);
        } catch (e) {
          toast.show(e instanceof Error && e.message ? e.message : t("dialogs.shareLiveFailed"), "error");
          return;
        }
        setLiveLink(link);
        try {
          await navigator.clipboard.writeText(link);
          toast.show(t("dialogs.shareLiveLinkCopied"), "success");
          onClose();
        } catch {
          toast.show(t("editor.shareLinkCopyFailed"), "error"); // the link stays on screen to copy by hand
        }
        return;
      }
      const opts: ShareLinkOptions = { view, readOnly: access === "readOnly" };
      const copied = target.kind === "doc" ? await onShareDoc(target.id, opts) : await onShareFolder(target.id, opts);
      if (copied) onClose();
    } finally {
      setBusy(false);
    }
  };

  const stopLive = async () => {
    if (!target || !liveShares || busy) return;
    setBusy(true);
    try {
      await liveShares.unpublish(target.id);
      setLiveLink(null);
      setAccess("copy");
      toast.show(t("dialogs.shareLiveStopped"), "success");
    } catch {
      toast.show(t("dialogs.shareLiveFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const views: { v: ShareView; label: string }[] = [
    { v: "split", label: t("dialogs.shareViewSplit") },
    { v: "md", label: t("dialogs.shareViewMarkdown") },
    { v: "html", label: t("dialogs.shareViewHtml") },
  ];
  const options: { a: Access; icon: ElementType; title: string; body: string; disabled?: boolean; note?: string }[] = [
    { a: "copy", icon: Pencil, title: t("dialogs.shareCopyTitle"), body: t("dialogs.shareCopyBody") },
    { a: "readOnly", icon: Lock, title: t("dialogs.shareReadOnlyTitle"), body: t("dialogs.shareReadOnlyBody") },
    ...(liveShares
      ? [{
          a: "live" as const, icon: RadioTower, title: t("dialogs.shareLiveTitle"), body: t("dialogs.shareLiveBody"),
          disabled: !liveAvailable, note: liveAvailable ? undefined : t("dialogs.shareLiveFolder"),
        }]
      : []),
  ];

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent closeLabel={t("common.close")} data-share-dialog="">
        <DialogHeader>
          <DialogTitle>{t("dialogs.shareTitle", { name: target?.name ?? "" })}</DialogTitle>
          <DialogDescription>{t("dialogs.shareDescription")}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <div id="pf-share-view" className="text-xs font-medium">{t("dialogs.shareOpensIn")}</div>
            <div role="group" aria-labelledby="pf-share-view" className="inline-flex w-full rounded-md border border-border p-0.5">
              {views.map((o) => (
                <button
                  key={o.v}
                  type="button"
                  aria-pressed={view === o.v}
                  onClick={() => setView(o.v)}
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                    view === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div id="pf-share-access" className="text-xs font-medium">{t("dialogs.shareAccess")}</div>
            <div role="radiogroup" aria-labelledby="pf-share-access" className="grid gap-2">
              {options.map(({ a, icon: Icon, title, body, disabled, note }) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={access === a}
                  disabled={disabled}
                  onClick={() => setAccess(a)}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    access === a ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
                  )}
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", access === a ? "text-primary-strong" : "text-muted-foreground")} aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{note ?? body}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {access === "live" && shownLink && (
            <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs leading-snug text-muted-foreground">{t("dialogs.shareLiveOn")}</p>
              {problem && <p role="status" className="text-xs leading-snug text-amber-700 dark:text-amber-400">{problem}</p>}
              <Input readOnly value={shownLink} aria-label={t("dialogs.shareLiveLink")} className="h-8 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="link" size="sm" className="h-auto px-0 text-xs text-destructive" disabled={busy} onClick={() => void stopLive()}>
                {t("dialogs.shareLiveStop")}
              </Button>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t("common.cancel")}</DialogClose>
          <Button disabled={busy} onClick={() => void copy()}>
            <Copy className="size-3.5" />
            {access === "live" ? t("dialogs.shareCopyLiveLink") : t("dialogs.shareCopyLink")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
