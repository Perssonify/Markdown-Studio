import { useTheme } from "next-themes";

/**
 * Is the EFFECTIVE theme dark?
 *
 * `useTheme().resolvedTheme` reports the visitor's stored preference, NOT the
 * theme actually in force: when a provider pins the theme with `forcedTheme`,
 * next-themes applies the forced value to the document but leaves
 * `resolvedTheme` on the stored/default one, exposing the pin separately as
 * `forcedTheme`.
 *
 * Every component here read `resolvedTheme` alone, so a pinned theme was
 * honoured by the CSS (which follows the document attribute) and ignored by the
 * JavaScript that picks the CodeMirror theme, the card colours and the
 * light/dark source of a theme-aware image. In the iframe embed that meant
 * `?theme=light` produced a light page around a dark editor — the parameter is
 * documented, and the share/embed builder generates it.
 *
 * One hook so no consumer has to remember the distinction again.
 */
export function useIsDarkTheme(): boolean {
  const { resolvedTheme, forcedTheme } = useTheme();
  return (forcedTheme ?? resolvedTheme) === "dark";
}

/**
 * The effective theme name, for the few consumers that want the string (e.g.
 * passing a theme to a third-party widget) rather than a boolean.
 */
export function useThemeMode(): string | undefined {
  const { resolvedTheme, forcedTheme, theme } = useTheme();
  return forcedTheme ?? resolvedTheme ?? theme;
}
