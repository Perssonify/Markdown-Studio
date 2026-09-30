import { Grid3X3 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

/**
 * TableGridPicker — Interactive grid for selecting table dimensions.
 * Now fully typed and styled with Tailwind utility classes.
 */

const MAX_COLS = 8;
const MAX_ROWS = 6;

export interface TableGridPickerProps {
  onSelect: (options: { rows: number; cols: number; withHeaderRow: boolean }) => void;
  onClose: () => void;
  /** When embedded inside a dropdown/menu that already owns dismissal, drop the
   *  absolute positioning + own click-outside handler (they fight the menu). */
  inline?: boolean;
}

export function TableGridPicker({ onSelect, onClose, inline = false }: TableGridPickerProps) {
  const t = useT();
  const [hoverRow, setHoverRow] = useState<number>(0);
  const [hoverCol, setHoverCol] = useState<number>(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close on click outside (only for the standalone popover; when inline, the
  // host menu owns dismissal and a second document handler would double-fire).
  useEffect(() => {
    if (inline) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose, inline]);

  // Focus the grid so arrow keys work immediately when opened by keyboard.
  useEffect(() => {
    pickerRef.current?.focus();
  }, []);

  // Keyboard navigation: arrows grow/shrink the selection, Enter commits,
  // Escape closes. Makes the table picker fully operable without a mouse.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      const r = hoverRow || 1;
      const c = hoverCol || 1;
      if (e.key === "ArrowRight") { e.preventDefault(); setHoverCol(Math.min(MAX_COLS, c + 1)); setHoverRow(r); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setHoverCol(Math.max(1, c - 1)); setHoverRow(r); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setHoverRow(Math.min(MAX_ROWS, r + 1)); setHoverCol(c); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setHoverRow(Math.max(1, r - 1)); setHoverCol(c); }
      else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect({ rows: hoverRow || 1, cols: hoverCol || 1, withHeaderRow: true });
      }
    },
    [hoverRow, hoverCol, onClose, onSelect]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverRow(0);
    setHoverCol(0);
  }, []);

  return (
    <div
      ref={pickerRef}
      tabIndex={0}
      role="grid"
      aria-label={t("toolbar.tableSizeUseArrowKeys")}
      onKeyDown={onKeyDown}
      onMouseLeave={handleMouseLeave}
      className={
        inline
          ? "p-2 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
          : `
        absolute top-full left-0 z-100 mt-2 p-3 outline-none
        bg-popover border border-border rounded-xl shadow-2xl focus-visible:ring-2 focus-visible:ring-primary/40
        animate-in fade-in-0 zoom-in-95 duration-200
      `
      }
    >
      {/* Header Label */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <Grid3X3 className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">
          {t("toolbar.tableSize")}
        </span>
      </div>

      {/* Grid Canvas */}
      <div 
        className="grid gap-1" 
        style={{ gridTemplateColumns: `repeat(${MAX_COLS}, 1fr)` }}
      >
        {Array.from({ length: MAX_ROWS * MAX_COLS }, (_, i) => {
          const r = Math.floor(i / MAX_COLS);
          const c = i % MAX_COLS;
          const isActive = r < hoverRow && c < hoverCol;

          return (
            <div
              key={i}
              onMouseEnter={() => {
                setHoverRow(r + 1);
                setHoverCol(c + 1);
              }}
              onClick={(e) => {
                e.preventDefault();
                onSelect({ rows: r + 1, cols: c + 1, withHeaderRow: true });
              }}
              className={`
                w-5 h-5 rounded-sm cursor-pointer transition-all duration-75 border
                ${isActive 
                  ? "bg-primary/30 border-primary/50 shadow-[0_0_8px_color-mix(in_srgb,var(--primary)_20%,transparent)]"
                  : "bg-muted/50 border-border/40 hover:bg-muted-foreground/10"
                }
              `}
            />
          );
        })}
      </div>

      {/* Dimension Readout */}
      <div 
        className={`
          mt-3 pt-2 border-t border-border/40 text-center text-[11px] font-bold tracking-tight transition-colors
          ${hoverRow > 0 ? "text-primary-strong" : "text-muted-foreground/50"}
        `}
      >
        {hoverRow > 0 ? (
          <div className="flex items-center justify-center gap-1 tabular-nums animate-in fade-in slide-in-from-bottom-1">
            <span>{hoverCol}</span>
            <span className="text-[9px] font-normal opacity-40">×</span>
            <span>{hoverRow}</span>
            <span className="ml-1 font-medium opacity-60">{t("toolbar.columnsRows")}</span>
          </div>
        ) : (
          t("toolbar.selectDimensions")
        )}
      </div>
    </div>
  );
}