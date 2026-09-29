import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import React, { useState } from "react";

export interface Backlink {
  docId: string;
  title: string;
  context?: string;
}

export interface ForwardLink {
  docId: string;
  title: string;
}

export interface UnresolvedLink {
  target: string;
  displayText: string;
}

export interface BacklinksPanelProps {
  backlinks?: Backlink[];
  forwardLinks?: ForwardLink[];
  unresolved?: UnresolvedLink[];
  onNavigate: (docId: string) => void;
  /** Render the body only (no outer collapse strip) — used inside the bottom tray,
   *  which supplies its own tab header. */
  hideHeader?: boolean;
}

function BacklinksPanelComponent({
  backlinks = [],
  forwardLinks = [],
  unresolved = [],
  onNavigate,
  hideHeader = false,
}: BacklinksPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [tab, setTab] = useState<"back" | "forward" | "unresolved">("back");

  const total = backlinks.length + forwardLinks.length;
  if (total === 0 && unresolved.length === 0) {
    return hideHeader ? (
      <p className="px-4 py-6 text-center text-[12px] text-muted-foreground italic">No links in this document yet.</p>
    ) : null;
  }

  const body = (
    <div className="px-2 pb-3">
      <div className="flex gap-1 px-2 mb-2 border-b border-border">
        {[
          { key: "back" as const, label: `Backlinks (${backlinks.length})`, icon: ArrowDownLeft, color: "text-primary" },
          { key: "forward" as const, label: `Outgoing (${forwardLinks.length})`, icon: ArrowUpRight, color: "text-blue-500" },
          ...(unresolved.length > 0 ? [{ key: "unresolved" as const, label: `Broken (${unresolved.length})`, icon: AlertTriangle, color: "text-destructive" }] : []),
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-all relative
              ${tab === t.key
                ? `${t.color} bg-background border border-border border-b-background -mb-px rounded-t-md`
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-t-md"
              }`}
          >
            <t.icon className="w-3 h-3" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "back" && (
        <div className="max-h-[250px] overflow-y-auto pr-1 scrollbar-thin">
          {backlinks.length === 0 && (
            <p className="px-4 py-3 text-[11px] text-muted-foreground italic text-center border border-dashed border-border/50 rounded-md mx-2">
              No documents link to this one.
            </p>
          )}
          <div className="space-y-1 px-1">
            {backlinks.map((bl) => (
              <button
                key={bl.docId}
                onClick={() => onNavigate(bl.docId)}
                className="w-full text-left px-3 py-2 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground group border border-transparent hover:border-border"
              >
                <div className="flex items-center gap-2 text-[13px] font-medium text-foreground group-hover:text-primary transition-colors">
                  <ArrowDownLeft className="w-3.5 h-3.5 opacity-50" />
                  <span className="truncate">{bl.title}</span>
                </div>
                {bl.context && (
                  <div className="text-[11px] text-muted-foreground truncate mt-1 pl-5 font-serif italic border-l-2 border-primary/20 ml-1.5">
                    "{bl.context}"
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "forward" && (
        <div className="max-h-[250px] overflow-y-auto pr-1 scrollbar-thin">
          {forwardLinks.length === 0 && (
            <p className="px-4 py-3 text-[11px] text-muted-foreground italic text-center border border-dashed border-border/50 rounded-md mx-2">
              This document has no outgoing links.
            </p>
          )}
          <div className="space-y-1 px-1">
            {forwardLinks.map((fl, i) => (
              <button
                key={`${fl.docId}:${i}`}
                onClick={() => onNavigate(fl.docId)}
                className="w-full text-left px-3 py-2 rounded-md transition-colors hover:bg-accent hover:text-accent-foreground group border border-transparent hover:border-border"
              >
                <div className="flex items-center gap-2 text-[13px] font-medium text-foreground group-hover:text-blue-500 transition-colors">
                  <ArrowUpRight className="w-3.5 h-3.5 opacity-50" />
                  <span className="truncate">{fl.title}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "unresolved" && (
        <div className="max-h-[250px] overflow-y-auto pr-1 scrollbar-thin px-1">
          <div className="space-y-1">
            {unresolved.map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground bg-destructive/5 rounded-md border border-destructive/10">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive/70 shrink-0" />
                <span className="font-mono bg-background/50 px-1 py-0.5 rounded border border-border/50">[[{u.target}]]</span>
                {u.displayText !== u.target && (
                  <span className="opacity-60 truncate">→ {u.displayText}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  if (hideHeader) return body;

  return (
    <div className="border-t border-border bg-card/80 shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="flex items-center gap-2">
          <ChevronRight 
            className={`w-4 h-4 transition-transform duration-200 ${expanded ? "rotate-90 text-foreground" : ""}`}
          />
          <span className="uppercase tracking-wider">Document Links</span>
          <div className="flex items-center gap-2 ml-2 font-medium">
            <span className="flex items-center gap-0.5 text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded-sm">
              <ArrowDownLeft className="w-3 h-3" /> {backlinks.length}
            </span>
            <span className="flex items-center gap-0.5 text-blue-500/80 bg-blue-500/10 px-1.5 py-0.5 rounded-sm">
              <ArrowUpRight className="w-3 h-3" /> {forwardLinks.length}
            </span>
            {unresolved.length > 0 && (
              <span className="flex items-center gap-0.5 text-destructive/80 bg-destructive/10 px-1.5 py-0.5 rounded-sm">
                <AlertTriangle className="w-3 h-3" /> {unresolved.length}
              </span>
            )}
          </div>
        </div>
      </button>

      {expanded && body}
    </div>
  );
}

export const BacklinksPanel = React.memo(BacklinksPanelComponent);