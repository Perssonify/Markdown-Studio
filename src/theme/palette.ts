/**
 * Accent palette selection — orthogonal to next-themes' light/dark mode.
 * The chosen palette is applied as `data-palette` on <html> and persisted in
 * localStorage (so it survives reloads "by default" and applies before first
 * paint via initPalette() in main.tsx). CSS token overrides live in styles.css
 * under `[data-palette="…"]`.
 */

import { safeStorage } from "../utils/safe-storage";
import { t } from "../i18n";

export interface PaletteDef {
  id: string;
  label: string;
  /** CSS color used for the swatch preview in the picker. */
  swatch: string;
}

export const PALETTES: PaletteDef[] = [
  { id: "amber", get label() { return t("settings.paletteAmber"); }, swatch: "hsl(44, 98%, 48%)" },
  { id: "blue", get label() { return t("settings.paletteBlue"); }, swatch: "hsl(201, 90%, 48%)" },
  { id: "violet", get label() { return t("settings.paletteViolet"); }, swatch: "hsl(262, 83%, 58%)" },
  { id: "emerald", get label() { return t("settings.paletteEmerald"); }, swatch: "hsl(160, 84%, 39%)" },
  { id: "rose", get label() { return t("settings.paletteRose"); }, swatch: "hsl(347, 77%, 50%)" },
  // Monochrome: black accent in light mode, white accent in dark mode.
  { id: "mono", get label() { return t("settings.paletteMono"); }, swatch: "linear-gradient(135deg, #111 0 50%, #fff 50% 100%)" },
];

export const DEFAULT_PALETTE = "amber";
const STORAGE_KEY = "perssonify-palette";

/**
 * Accept only a safe CSS `<color>` (or `transparent`/`currentColor`) for a
 * host-supplied accent/background value before it's written into a CSS custom
 * property. Rejects anything containing `url(`, `image-set(`, `expression`,
 * `var(`, or declaration/selector punctuation (`;{}`) — a value like
 * `url(https://attacker/pixel)` would otherwise turn a themed surface into an
 * external tracking beacon. Returns undefined for anything not clearly a color.
 */
export function sanitizeCssColor(v: string | null | undefined): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  if (!s || s.length > 64) return undefined;
  if (/[;{}()]/.test(s)) {
    // The only functional forms we allow are the CSS color functions, with a
    // strictly numeric/keyword argument list (no url/var/nested functions).
    if (
      /^(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([0-9.,%/\sa-z-]+\)$/i.test(s) &&
      !/(url|image|expression|var|element)/i.test(s)
    ) {
      return s;
    }
    return undefined;
  }
  // #rgb / #rgba / #rrggbb / #rrggbbaa, or a bare color keyword (letters only).
  if (/^#[0-9a-fA-F]{3,8}$/.test(s) || /^[a-zA-Z]+$/.test(s)) return s;
  return undefined;
}

export function getStoredPalette(): string {
  // Through safeStorage: `typeof localStorage === "undefined"` sat OUTSIDE this
  // function's own try, and that expression throws when a browser blocks site
  // data (it evaluates the getter).
  const v = safeStorage.get(STORAGE_KEY);
  return v && PALETTES.some((p) => p.id === v) ? v : DEFAULT_PALETTE;
}

export function applyPalette(id: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-palette", id);
}

export function setPalette(id: string): void {
  safeStorage.set(STORAGE_KEY, id);   // unavailable storage still applies for this session
  applyPalette(id);
}

/** Apply the stored palette. Call once, early, before first render. */
export function initPalette(): void {
  applyPalette(getStoredPalette());
}
