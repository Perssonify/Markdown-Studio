import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import React, { type ReactNode } from "react";

export type NoticeTone = "critical" | "warning" | "info";

const TONE: Record<NoticeTone, string> = {
  critical: "border-destructive/40 bg-destructive/10",
  warning: "border-amber-500/40 bg-amber-500/10",
  info: "border-border bg-muted/60",
};
const ICON_TONE: Record<NoticeTone, string> = {
  critical: "text-destructive",
  warning: "text-amber-600 dark:text-amber-400",
  info: "text-primary-strong",
};

/**
 * One slim strip in the flow above the status bar — never a modal, never over
 * the text. Shared by the storage-durability notices and the tab-sync notice.
 */
export function NoticeStrip({
  tone,
  icon: Icon,
  role,
  label,
  hook,
  hookAttr = "data-durability-notice",
  children,
  actions,
}: {
  tone: NoticeTone;
  icon: React.ElementType;
  role: "alert" | "status";
  label: string;
  /** The notice's e2e hook — data, so it stays English whatever the interface language. */
  hook: string;
  /** Which data attribute carries `hook`. */
  hookAttr?: "data-durability-notice" | "data-tab-sync-notice";
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      role={role}
      aria-label={label}
      {...{ [hookAttr]: hook }}
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t px-3 py-1.5 text-xs text-foreground",
        TONE[tone],
      )}
    >
      <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
        <Icon className={cn("mt-0.5 size-3.5 shrink-0", ICON_TONE[tone])} aria-hidden />
        <div className="min-w-0 leading-snug">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions}</div>}
    </div>
  );
}

/** The strips' button size — a 36px target on a coarse pointer. */
export const noticeButton = "h-7 gap-1 px-2.5 text-xs pointer-coarse:h-9";

export function NoticeDismiss({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-7 text-muted-foreground hover:text-foreground pointer-coarse:size-9"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <X className="size-3.5" />
    </Button>
  );
}
