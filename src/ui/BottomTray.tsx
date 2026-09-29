import { ChevronDown } from "lucide-react";
import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TrayTab {
  id: string;
  label: string;
  icon?: React.ElementType;
  content: ReactNode;
}

export interface BottomTrayProps {
  open: boolean;
  activeTab: string;
  onTabChange: (id: string) => void;
  onClose: () => void;
  tabs: TrayTab[];
}

/**
 * Expandable bottom tray that sits directly above the status bar. Hosts tabbed
 * panels (Document Links, and a diagnostics Console when the admin flag is on).
 *
 * Collapsed it still costs ZERO vertical space — that invariant is unchanged —
 * but it gets there through `grid-template-rows: 0fr` rather than by returning
 * null, so opening and closing animate instead of appearing as a 256px layout
 * jump in a single frame. The cost of the change is that the active tab's
 * content stays mounted while collapsed; it is one small panel, and the
 * alternative (unmounting on close) animates an empty box on the way down.
 * Users who ask for reduced motion get the old instant behaviour for free —
 * the global guard in styles.css flattens this transition like any other.
 */
function RawBottomTray({ open, activeTab, onTabChange, onClose, tabs }: BottomTrayProps) {
  if (tabs.length === 0) return null;
  const active = tabs.find((t) => t.id === activeTab) ?? tabs[0]!;
  return (
    <div
      className="grid shrink-0 transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">
    <div className="flex h-64 min-h-0 max-h-[min(35dvh,16rem)] flex-col border-t border-border bg-card/95 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => onTabChange(t.id)}
              aria-selected={active.id === t.id}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                active.id === t.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {Icon && <Icon className="size-3.5" />}
              {t.label}
            </button>
          );
        })}
        <button
          onClick={onClose}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Collapse tray"
          title="Collapse"
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{active.content}</div>
    </div>
      </div>
    </div>
  );
}

export const BottomTray = React.memo(RawBottomTray);
