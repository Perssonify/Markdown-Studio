import { ChevronDown } from "lucide-react";
import React, { type ReactNode, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useRovingFocus } from "../hooks/use-roving-focus";
import { useT } from "@/i18n";

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
 *
 * A093. Staying mounted is also why the collapsed tray is made `inert`, not
 * just `aria-hidden`: `aria-hidden` removed it from the accessibility tree but
 * left its tab buttons and collapse chevron in the Tab order, so keyboard focus
 * walked into controls no one could see (axe `aria-hidden-focus`, every
 * surface). React 18 does not forward `inert` as a prop, so it is set
 * imperatively — the same pattern PerssonifyEditor uses for the overlays.
 */
function RawBottomTray({ open, activeTab, onTabChange, onClose, tabs }: BottomTrayProps) {
  const t = useT();
  const trayRef = useRef<HTMLDivElement>(null);
  const tablistRef = useRef<HTMLDivElement>(null);
  /** Where focus was when the tray opened — the status-bar toggle or links
   *  chip that opened it. Collapsing hands focus back there. */
  const openerRef = useRef<HTMLElement | null>(null);

  // Layout effect: a tray that mounts collapsed must be inert before the first
  // paint, or one Tab press in that frame can still land inside it.
  useLayoutEffect(() => {
    const tray = trayRef.current;
    if (!tray) return;
    if (open) {
      const active = document.activeElement as HTMLElement | null;
      openerRef.current = active && !tray.contains(active) ? active : null;
      tray.removeAttribute("inert");
      return;
    }
    // Making the region inert while it holds focus drops focus on <body>, so a
    // keyboard user who collapsed the tray from its own chevron lost their
    // place. Return it to whatever opened the tray.
    if (tray.contains(document.activeElement)) {
      const back = openerRef.current;
      if (back && back.isConnected) back.focus();
      else (document.activeElement as HTMLElement | null)?.blur?.();
    }
    tray.setAttribute("inert", "");
  }, [open]);

  useRovingFocus(tablistRef, {
    itemSelector: '[role="tab"]',
    // Automatic activation: moving to a tab shows it.
    onNavigate: (el) => el.click(),
  });

  if (tabs.length === 0) return null;
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]!;
  const panelId = "pf-tray-panel";
  return (
    <div
      ref={trayRef}
      data-print-hide
      className="grid shrink-0 transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      aria-hidden={!open}
    >
      <div className="min-h-0 overflow-hidden">
    <div className="flex h-64 min-h-0 max-h-[min(35dvh,16rem)] flex-col border-t border-border bg-card/95 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <div ref={tablistRef} role="tablist" aria-label={t("status.panelTray")} className="flex items-center gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = active.id === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`pf-tray-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={panelId}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                  selected ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {Icon && <Icon className="size-3.5" aria-hidden />}
                {tab.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={t("status.collapseTray")}
          title={t("status.collapse")}
        >
          <ChevronDown className="size-4" />
        </button>
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={`pf-tray-tab-${active.id}`}
        className="min-h-0 flex-1 overflow-auto"
      >
        {active.content}
      </div>
    </div>
      </div>
    </div>
  );
}

export const BottomTray = React.memo(RawBottomTray);
