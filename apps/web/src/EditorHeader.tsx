import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import { APP_BRAND, APP_NAME } from "./constants";


export function EditorHeader() {
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
            </div>
            <span className="text-[10px] font-bold text-muted-foreground/60 uppercase tracking-normal leading-none">
              {APP_BRAND}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
