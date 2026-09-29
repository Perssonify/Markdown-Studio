import { Input } from "@/components/ui/input";
import { FileTextIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchResult } from "@/store/search";

interface SearchPanelProps {
  open: boolean;
  /** Runs the search against the current document set. */
  search: (query: string) => SearchResult[];
  onOpenResult: (docId: string, query: string) => void;
  onClose: () => void;
}

/**
 * Global "search all notes" overlay. Fuzzy-free substring search with ranked
 * results, a highlighted snippet per hit, and keyboard navigation (↑/↓/Enter/Esc).
 * Opens the chosen document and hands the query back so the editor can jump to it.
 */
export function SearchPanel({ open, search, onOpenResult, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(
    () => (query.trim() ? search(query) : []),
    [query, search]
  );

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the active row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (idx: number) => {
    const r = results[idx];
    if (r) {
      onOpenResult(r.id, query.trim());
      onClose();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(active);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-[12vh] px-4 animate-in fade-in duration-100"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Search all notes"
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-background ring-1 ring-foreground/10 shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground/60" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all notes…"
            className="h-11 border-0 bg-transparent px-0 text-base md:text-sm shadow-none focus-visible:ring-0"
            aria-label="Search all notes"
          />
          {query.trim() && (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">
              {results.length} result{results.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <ul ref={listRef} className="flex-1 overflow-y-auto p-1" role="listbox" aria-label="Search results">
          {query.trim() && results.length === 0 && (
            <li className="px-3 py-8 text-center text-xs text-muted-foreground/60">
              No matches for “{query.trim()}”
            </li>
          )}
          {results.map((r, i) => (
            <li key={r.id} data-idx={i} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={`flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left ${
                  i === active ? "bg-card" : "hover:bg-card/60"
                }`}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground/50" />
                  <span className="truncate">{r.title}</span>
                  {r.count > 0 && (
                    <span className="ml-1 shrink-0 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
                      {r.count}
                    </span>
                  )}
                </span>
                {r.snippet ? (
                  <span className="line-clamp-2 pl-5 text-[11px] leading-snug text-muted-foreground">
                    {r.snippet.before}
                    <mark className="rounded-[2px] bg-primary/25 text-foreground">{r.snippet.match}</mark>
                    {r.snippet.after}
                  </span>
                ) : (
                  <span className="pl-5 text-[11px] text-muted-foreground/60">Title match</span>
                )}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground/60">
          <span><kbd className="font-sans">↑↓</kbd> navigate</span>
          <span><kbd className="font-sans">↵</kbd> open</span>
          <span><kbd className="font-sans">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
