import { ListTree } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  ancestorHeadingIndices,
  buildHeadingTree,
  type OutlineHeading,
  type OutlineTreeNode,
} from "@/store/doc-outline";
import { useT } from "../i18n";

/**
 * Outline primitives — `TocList` (a live, active-following table of contents) and
 * its `EmptyOutline` placeholder. Consumed by the Workspace panel's Outline tab
 * (`src/ui/WorkspacePanel.tsx`). The former standalone `DocNavPanel` component and
 * its `split` document-structure view were removed; this module is retained as the
 * home of these shared list primitives.
 */

const ROW_H = 28; // px — must match the row min-height for correct sticky stacking

export function EmptyOutline() {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-muted-foreground">
      <ListTree className="size-6 opacity-20" />
      <p className="text-xs font-medium">{t("library.noHeadingsYet")}</p>
      <p className="text-[11px] opacity-70">{t("library.outlineEmptyHint")}</p>
    </div>
  );
}

export function TocList({
  headings,
  activeIndex,
  onNavigate,
}: {
  headings: OutlineHeading[];
  activeIndex: number | null;
  onNavigate: (index: number) => void;
}) {
  const tree = useMemo(() => buildHeadingTree(headings), [headings]);
  const ancestors = useMemo(
    () => new Set(ancestorHeadingIndices(headings, activeIndex)),
    [headings, activeIndex]
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);

  // Keep the active row visible inside the PANEL's own scroll container — never
  // the editor (that would perturb the two-pane scroll-sync).
  useEffect(() => {
    const el = activeRowRef.current;
    const scroller = scrollRef.current;
    if (!el || !scroller) return;
    const er = el.getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    if (er.top < sr.top + ROW_H || er.bottom > sr.bottom) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  if (headings.length === 0) return <div className="min-h-0 flex-1 overflow-y-auto"><EmptyOutline /></div>;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-1">
      <ul>
        {tree.map((node) => (
          <TocNode
            key={node.index}
            node={node}
            depth={0}
            activeIndex={activeIndex}
            ancestors={ancestors}
            onNavigate={onNavigate}
            activeRowRef={activeRowRef}
          />
        ))}
      </ul>
    </div>
  );
}

function TocNode({
  node,
  depth,
  activeIndex,
  ancestors,
  onNavigate,
  activeRowRef,
}: {
  node: OutlineTreeNode;
  depth: number;
  activeIndex: number | null;
  ancestors: Set<number>;
  onNavigate: (index: number) => void;
  activeRowRef: React.RefObject<HTMLButtonElement>;
}) {
  const t = useT();
  const isActive = node.index === activeIndex;
  const isAncestor = ancestors.has(node.index);
  const hasChildren = node.children.length > 0;

  const row = (
    <button
      ref={isActive ? activeRowRef : undefined}
      type="button"
      onClick={() => onNavigate(node.index)}
      title={node.text || t("library.untitledHeading")}
      aria-current={isActive ? "location" : undefined}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={cn(
        "group flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs outline-none transition-colors focus-visible:ring-1 focus-visible:ring-primary",
        "min-h-7", // ROW_H
        isActive
          ? "bg-primary/15 font-semibold text-foreground"
          : isAncestor
            ? "text-foreground hover:bg-accent"
            : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "shrink-0 rounded-full transition-colors",
          isActive ? "size-1.5 bg-primary" : isAncestor ? "size-1 bg-primary/50" : "size-1 bg-muted-foreground/30"
        )}
      />
      <span className="min-w-0 flex-1 truncate">{node.text || t("library.untitledHeading")}</span>
    </button>
  );

  return (
    <li>
      {hasChildren ? (
        // Parent rows stick to the top, stacked by depth, so the enclosing
        // section stays visible while its children scroll beneath.
        <div className="sticky z-[1] bg-card/95 backdrop-blur-sm" style={{ top: depth * ROW_H }}>
          {row}
        </div>
      ) : (
        row
      )}
      {hasChildren && (
        <ul>
          {node.children.map((child) => (
            <TocNode
              key={child.index}
              node={child}
              depth={depth + 1}
              activeIndex={activeIndex}
              ancestors={ancestors}
              onNavigate={onNavigate}
              activeRowRef={activeRowRef}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
