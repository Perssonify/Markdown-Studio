import "@fontsource-variable/geist";
import "@fontsource-variable/inter";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "next-themes";
import { useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { PerssonifyEditorIntegration, type EditorHandle } from "./integration/PerssonifyEditorIntegration";
import { embedStorageConfig, resolveEmbedAllowedOrigins } from "./integration/embed-origins";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { useUIStore } from "./store/uiStore";
import { sanitizeCssColor } from "./theme/palette";
import "./styles.css";
import { initPalette } from "./theme/palette";
import { installGlobalErrorCapture } from "./utils/diagnostics";

// The embed owns its document (it is its own iframe), so it may capture that
// document's uncaught errors — locally, like the standalone app. Never done by
// the library entry, where the page belongs to the host.
installGlobalErrorCapture();
initPalette();

/**
 * Which origin(s) this embed will exchange host-bridge messages with.
 *
 * It used to be `[window.location.origin]`. Inside the iframe that is the
 * EDITOR's origin, while an inbound message's `event.origin` is the HOST's — so
 * `createHostBridge` dropped every one, and the outbound `emit` posted to the
 * app's own origin while targeting the parent window, so `ready` / `onChange`
 * were discarded too. Every action in docs/integration-guide.md was inert
 * against the shipped /embed.html, and no parameter could widen it.
 *
 * The rules live in integration/embed-origins.ts: a deploy-time allowlist
 * (VITE_EMBED_ALLOWED_ORIGINS) has the last word; where the browser reports the
 * real framer (`location.ancestorOrigins`) a requested origin must be it; then
 * `?allowed_origin=` (never "*"), the reported framer, or `document.referrer`.
 */
function resolveAllowedOrigins(params: URLSearchParams): string[] {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return resolveEmbedAllowedOrigins({
    params,
    referrer: document.referrer,
    ancestorOrigins: (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins,
    deployAllowlist: env?.["VITE_EMBED_ALLOWED_ORIGINS"],
  });
}

/**
 * Where this embed keeps its documents (A072): a database of its own when it is
 * served from one of the app's hosts, so a page framing it there can never
 * reach the app's library; the name it has always had anywhere else, so no
 * self-hosted embed opens on an empty library. See embedStorageConfig.
 */
const embedStorage = embedStorageConfig(window.location.hostname);

/**
 * Iframe embed shell. Host apps configure the editor declaratively through the
 * iframe `src` query string, so no post-ready round-trip is needed for the
 * common cases:
 *
 *   /editor/?mode=html&theme=dark&accent=blue
 *   /editor/?accentColor=%237fb0ff        (URL-encoded #7fb0ff)
 *
 *   mode        "split" | "md" | "html"   initial view mode (a user's stored
 *                                         preference still wins on later opens)
 *   theme       "dark" | "light"          light/dark (default dark)
 *   accent      preset palette id          amber|blue|violet|emerald|rose|mono
 *   accentColor any CSS color              custom accent (overrides `accent`)
 *   chrome      "full"|"minimal"|"none"    UI chrome level (default full)
 *   allowed_origin  an origin, repeatable   the host origin(s) the bridge will
 *                                         talk to. Optional: with none, the
 *                                         embed talks to whoever framed it
 *                                         (document.referrer's origin). Never
 *                                         "*".
 *   bg          "transparent" | CSS color  panel background — "transparent" lets
 *                                          the host scene show through (the host
 *                                          must also set the iframe element's own
 *                                          background to transparent)
 *
 * A real `ref` is passed to PerssonifyEditorIntegration; the host bridge reads
 * the live EditorHandle from it. (The wrapper also keeps an internal handle ref,
 * so the bridge works even without this ref — but passing one is good practice
 * and makes the handle available to this shell too.)
 */

function EmbedApp() {
  const ref = useRef<EditorHandle>(null);
  const params = new URLSearchParams(window.location.search);

  // `view_mode` is a synonym for `mode` (md|html|split); the URL builder emits it.
  const modeParam = params.get("mode") ?? params.get("view_mode");
  const initialMode =
    modeParam === "html" || modeParam === "md" || modeParam === "split" ? modeParam : undefined;

  const isDark = params.get("theme") !== "light";
  const accent = params.get("accent") || undefined;
  // Validate the free-form CSS color so a host-supplied value can't smuggle a
  // url()/expression() beacon into a CSS custom property.
  const accentColor = sanitizeCssColor(params.get("accentColor"));

  const chromeParam = params.get("chrome");
  const chrome =
    chromeParam === "minimal" || chromeParam === "none" || chromeParam === "full"
      ? chromeParam
      : undefined;

  // Background: "transparent" lets the 3D scene show through (the host must also
  // set the iframe element's own background to transparent); any other value is
  // treated as a CSS color for the editor surface. Applied as a scoped
  // --background override; when transparent we also clear the embed's html/body
  // background so nothing paints behind the (transparent) editor surface.
  const rawBg = params.get("bg") || undefined;
  // "transparent" is a literal special case; any other value must pass the CSS
  // color allowlist before it's written as a --background custom property.
  const bgParam = rawBg === "transparent" ? "transparent" : sanitizeCssColor(rawBg);
  const themeVars = bgParam
    ? { "--background": bgParam }
    : undefined;

  useEffect(() => {
    if (bgParam === "transparent") {
      document.documentElement.style.background = "transparent";
      document.body.style.background = "transparent";
    }
  }, [bgParam]);

  // Resolved ONCE: the framing page does not change under us. (It was keyed on
  // `params`, a new object every render, so each render handed the integration
  // a new array and it tore down and re-created the host bridge.)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const allowedOrigins = useMemo(() => resolveAllowedOrigins(params), []);

  // Read-only deep-link (the URL builder emits it). Applied SESSION-ONLY via
  // setState — never the persisting setter, or one host embedding with
  // ?readonly=1 would write pf:read-only for the whole origin and leave the
  // standalone app (same key) stuck read-only. Mirrors App.tsx.
  useEffect(() => {
    const ro = params.get("readonly");
    if (ro !== null) useUIStore.setState({ readOnly: ro === "true" || ro === "1" });
    // (`?ads=` is no longer applied: ad slots only render in dev builds.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PerssonifyEditorIntegration
      ref={ref}
      storageConfig={embedStorage}
      allowedOrigins={allowedOrigins}
      isDark={isDark}
      initialMode={initialMode}
      chrome={chrome}
      accent={accent}
      accentColor={accentColor}
      themeVars={themeVars}
    />
  );
}

/** An explicit `?theme=` pins the embed; absent, the stored preference wins. */
const embedForcedTheme = (() => {
  try {
    const t = new URLSearchParams(window.location.search).get("theme");
    return t === "light" || t === "dark" ? t : undefined;
  } catch {
    return undefined;
  }
})();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    /* `forcedTheme` when the host asked for a specific theme.
       next-themes makes a NESTED ThemeProvider a no-op — it returns the existing
       context and renders children as-is — so the integration's own
       `forcedTheme={isDark…}` has never had any effect inside the embed, where
       THIS provider is the outer one. `?theme=light` therefore themed the
       integration wrapper's `data-theme` but left every component that reads
       `resolvedTheme` (the CodeMirror theme, the rich pane, Cards, theme-aware
       images) on this provider's stored/default dark. Pinning it here is what
       actually makes the documented parameter work; with no parameter the
       visitor's stored preference and the in-embed picker behave as before. */
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      storageKey="perssonify-theme"
      enableSystem
      // Same reason as the standalone shell: a partial theme fade stutters.
      disableTransitionOnChange
      forcedTheme={embedForcedTheme}
    >
      <ErrorBoundary isDark>
        <EmbedApp />
      </ErrorBoundary>
    </ThemeProvider>,
  );
}
