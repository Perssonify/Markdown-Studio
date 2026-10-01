/**
 * Shared appearance controls — the theme (Light / Dark / System) and accent
 * palette pickers, rendered as labeled color circles. Used by both the View ▸
 * Appearance menu (MenuBar) and the Settings sheet so the two never drift.
 *
 * Theme is next-themes' raw `theme` (so "System" is a real, selectable value —
 * not collapsed to the resolved light/dark). Accent palette is orthogonal to
 * light/dark (see theme/palette.ts).
 */
import { Check } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { DEFAULT_PALETTE, getStoredPalette, PALETTES, setPalette } from "../theme/palette";
import { t, useT } from "../i18n";

export const THEME_OPTIONS = [
  { id: "light", get label() { return t("settings.themeLight"); } },
  { id: "dark", get label() { return t("settings.themeDark"); } },
  { id: "system", get label() { return t("settings.themeSystem"); } },
] as const;

/** A small color circle previewing a theme: a light disc, a dark disc, or a
 *  split disc for "System" (follows the OS). Decorative — the label carries the
 *  accessible name. */
export function ThemeSwatch({ theme, className }: { theme: string; className?: string }) {
  const style =
    theme === "light"
      ? { background: "#fafafa", borderColor: "#d4d4d8" }
      : theme === "dark"
        ? { background: "#18181b", borderColor: "#52525b" }
        : {
            background: "linear-gradient(135deg, #fafafa 0 50%, #18181b 50% 100%)",
            borderColor: "#a1a1aa",
          };
  return (
    <span
      aria-hidden
      className={cn("inline-block size-3.5 shrink-0 rounded-full border", className)}
      style={style}
    />
  );
}

/** Compact theme picker (Light / Dark / System) as labeled circles. */
export function ThemeCircleRow() {
  useT(); // THEME_OPTIONS labels read the language: re-render on a switch
  const { theme, setTheme } = useTheme();
  // next-themes resolves `theme` only after mount; guard so the active pill is
  // correct on the client instead of flashing the wrong one.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current = mounted ? theme ?? "system" : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {THEME_OPTIONS.map((o) => {
        const active = current === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setTheme(o.id)}
            aria-pressed={active}
            title={o.label}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
              active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
            )}
          >
            <ThemeSwatch theme={o.id} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Compact accent-palette picker as color circles. */
export function AccentCircleRow() {
  const t = useT();
  const [palette, setPaletteState] = useState(DEFAULT_PALETTE);
  useEffect(() => setPaletteState(getStoredPalette()), []);
  const change = (id: string) => {
    setPalette(id);
    setPaletteState(id);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTES.map((p) => {
        const active = palette === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => change(p.id)}
            aria-pressed={active}
            title={p.label}
            aria-label={t("settings.accentAria", { name: p.label })}
            className={cn(
              "relative size-7 rounded-full border transition-transform hover:scale-105",
              active ? "border-primary ring-2 ring-primary/40" : "border-border"
            )}
            style={{ background: p.swatch }}
          >
            {active && (
              <Check
                className="absolute inset-0 m-auto size-3.5 text-white"
                style={{ filter: "drop-shadow(0 0 1px rgba(0,0,0,0.6))" }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
