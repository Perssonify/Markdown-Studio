import { renderHook } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import { beforeAll, describe, expect, it } from "vitest";
import { useIsDarkTheme, useThemeMode } from "../theme/useThemeMode";

/**
 * next-themes' `resolvedTheme` reports the visitor's stored PREFERENCE, not the
 * theme actually in force: a provider pinning the theme with `forcedTheme`
 * applies the forced value to the document but leaves `resolvedTheme` alone and
 * exposes the pin separately.
 *
 * Everything that picked a theme in JavaScript — the CodeMirror theme, card
 * colours, theme-aware image sources — read `resolvedTheme` alone, so a pinned
 * theme was honoured by the CSS and ignored by the JS. In the iframe embed that
 * made the documented `?theme=light` parameter produce a light page around a
 * dark editor, and the share/embed builder generates that parameter.
 */
// jsdom has no matchMedia; next-themes probes it on mount.
beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false; },
    });
  }
});

const wrapper = (forcedTheme, defaultTheme = "dark") =>
  function Wrapper({ children }) {
    return (
      <ThemeProvider
        attribute="class"
        defaultTheme={defaultTheme}
        forcedTheme={forcedTheme}
        enableSystem={false}
        storageKey="pf-test-theme"
      >
        {children}
      </ThemeProvider>
    );
  };

describe("useIsDarkTheme", () => {
  it("follows a forced LIGHT theme even when the stored default is dark", () => {
    const { result } = renderHook(() => useIsDarkTheme(), { wrapper: wrapper("light", "dark") });
    expect(result.current).toBe(false);
  });

  it("follows a forced DARK theme even when the stored default is light", () => {
    const { result } = renderHook(() => useIsDarkTheme(), { wrapper: wrapper("dark", "light") });
    expect(result.current).toBe(true);
  });

  it("falls back to the resolved preference when nothing is forced", () => {
    const { result } = renderHook(() => useIsDarkTheme(), { wrapper: wrapper(undefined, "dark") });
    expect(result.current).toBe(true);
  });
});

describe("useThemeMode", () => {
  it("returns the forced theme name when one is pinned", () => {
    const { result } = renderHook(() => useThemeMode(), { wrapper: wrapper("light", "dark") });
    expect(result.current).toBe("light");
  });

  it("returns the resolved preference otherwise", () => {
    const { result } = renderHook(() => useThemeMode(), { wrapper: wrapper(undefined, "light") });
    expect(result.current).toBe("light");
  });
});
