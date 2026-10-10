import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { ReactNode, useEffect, useRef } from "react";
import { useT } from "@/i18n";

interface PageChromeProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional actions rendered on the right of the page header. */
  actions?: ReactNode;
}

/**
 * Full-screen shell for the app's interior pages (About, Help). Renders above
 * the (still-mounted) editor with a back affordance; Escape returns to the
 * editor. Theme-aware via the app's design tokens.
 */
export function PageChrome({ title, onClose, children, actions }: PageChromeProps) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip if a layer above us (dialog, tour) already consumed this Escape.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /**
   * These interior pages cover the whole viewport while the editor stays
   * mounted as a DOM sibling behind them. Without this, focus never entered the
   * page (Tab from the "Back to editor" button walked straight into the hidden
   * editor), the previously focused element was never restored on close, and a
   * screen reader still read the covered application. `inert` is applied
   * imperatively because React 18 does not forward it as a prop.
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = rootRef.current;
    const restoreTo = document.activeElement as HTMLElement | null;
    node?.focus();
    const covered: Element[] = [];
    const siblings: Element[] = node?.parentElement ? Array.from(node.parentElement.children) : [];
    for (const sibling of siblings) {
      if (sibling === node) continue;
      sibling.setAttribute("inert", "");
      covered.push(sibling);
    }
    return () => {
      for (const sibling of covered) sibling.removeAttribute("inert");
      if (restoreTo && document.body.contains(restoreTo)) restoreTo.focus?.();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground outline-none animate-in fade-in duration-200"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3 backdrop-blur">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">{t("pages.backToEditor")}</span>
        </Button>
        <span className="ml-1 truncate text-sm font-semibold">{title}</span>
        {actions && <div className="ml-auto flex items-center gap-1">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
