import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { APP_BRAND, APP_NAME } from "./constants";
import { VersionBadge } from "./ui/chrome/versionBadge";

interface EditorHeaderProps {
  /**
   * Standalone app only: the account control (sign in / the signed-in
   * account's menu), rendered at the right end of this top header — the
   * conventional top-right corner for a user profile. Omitted by the library
   * and the iframe embed, which have no accounts.
   */
  accountControl?: ReactNode;
}

export function EditorHeader({ accountControl }: EditorHeaderProps) {
  return (
    <header
      className={cn(
        "pf-safe-top w-full border-b border-border transition-all duration-300",
        "bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/60"
      )}
    >
      <div className="mx-auto flex h-12 items-center px-4">

        {/* Left: Branding (theme + accent controls now live in the menu bar's
            View ▸ Appearance submenu, so this stays a clean title bar). */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 shadow-sm shadow-primary/20">
            <FileText className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-col flex">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-foreground truncate">
                {APP_NAME}
              </span>
              <VersionBadge className="hidden sm:inline-flex" />
            </div>
            <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-normal leading-none">
              {APP_BRAND}
            </span>
          </div>
        </div>

        {/* Right: the account control sits in the top-right corner. */}
        {accountControl && <div className="ml-auto flex shrink-0 items-center pl-2">{accountControl}</div>}
      </div>
    </header>
  );
}
