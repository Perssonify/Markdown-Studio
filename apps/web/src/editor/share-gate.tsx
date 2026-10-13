import { CircleHelp } from "lucide-react";
import { createContext, type ReactElement, useContext } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Why sharing is unavailable right now, or undefined when it is available.
 * PerssonifyEditor provides it from its `shareDisabledReason` prop (the
 * standalone app sets "Sign in to share…" for signed-out visitors); the share
 * controls (the menu bar's Share button, "Copy share link" on notes and
 * folders) read it. Context, not props: those controls sit several levels down
 * the workspace panel, inside menus rendered in portals.
 */
export const ShareGateContext = createContext<string | undefined>(undefined);

export const useShareGate = (): string | undefined => useContext(ShareGateContext);

/**
 * The attributes of a share control while sharing is unavailable: announced
 * as unavailable, with the reason, and still focusable and clickable, so the
 * reason can be shown on a tap too (a `disabled` element gets no hover and no
 * tooltip). The visible hint is the ShareHint tooltip and the ? icon.
 */
export function gatedShareProps(reason: string | undefined) {
  return reason ? { "aria-disabled": true as const, "aria-description": reason, "data-share-gated": "" } : {};
}

/**
 * Wraps a share control in the app's tooltip (shadcn / Base UI). `text` is
 * shown on hover and keyboard focus; on a phone, a tap on a gated control shows
 * the same text as a toast instead (PerssonifyEditor's shareDoc / shareFolder).
 */
export function ShareHint({
  text,
  side = "bottom",
  children,
}: {
  text: string | undefined;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) {
  if (!text) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className="max-w-60 text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

/** The ? beside a greyed-out share control: says there is an explanation to hover for. */
export function ShareHelpIcon({ className }: { className?: string }) {
  return <CircleHelp aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}
