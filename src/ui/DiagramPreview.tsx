import { useEffect, useRef, useState } from "react";
import { cachedImport, isChunkLoadError } from "../utils/lazy-import";
import { useT } from "../i18n";

/**
 * Lazy-loaded live preview for fenced code blocks whose language is a diagram
 * or music notation. Mermaid and abcjs are heavy, so they're dynamically
 * imported only when such a block actually appears (kept out of the main bundle).
 * The fenced source stays editable in the code block above; this is preview-only,
 * so ```mermaid / ```abc round-trip to Markdown for free.
 */

// A rejected import is not memoised: a promise that kept its rejection meant one
// offline moment left every diagram broken for the rest of the session.
const getMermaid = cachedImport(() => import("mermaid").then((m) => m.default));
const loadAbc = cachedImport(() => import("abcjs"));
async function getAbc() {
  const mod = await loadAbc();
  return (mod as { default?: typeof import("abcjs") }).default ?? mod;
}

/**
 * Config keys a diagram may NOT set for itself (via `%%{init}%%` or front-matter
 * `config:`) — only this `initialize` call can.
 *
 * Mermaid pastes `themeCSS`, the font families and the theme variables into the
 * diagram's own `<style>` block, scoped to the SVG's id. Its directive sanitiser
 * only checks that braces balance, and with CSS nesting a perfectly balanced
 * rule such as `body:has(&) { … }` leaves that scope and restyles the page
 * around the diagram — in the app that also holds every stored document. Any
 * opened or imported document can carry such a directive, and `securityLevel:
 * "strict"` does not cover it. Mermaid unions this list with its own, which is
 * restated first so the guarantee does not depend on that merge behaviour.
 */
export const MERMAID_SECURE_KEYS = [
  "secure",
  "securityLevel",
  "startOnLoad",
  "maxTextSize",
  "suppressErrorRendering",
  "maxEdges",
  "themeCSS",
  "themeVariables",
  "fontFamily",
  "altFontFamily",
  "dompurifyConfig",
] as const;

/** The only configuration a diagram is rendered with (plus what it may set). */
export function mermaidConfig(dark: boolean) {
  return {
    startOnLoad: false,
    securityLevel: "strict" as const,
    theme: dark ? ("dark" as const) : ("default" as const),
    secure: [...MERMAID_SECURE_KEYS],
    // Mermaid's defaults, stated so an upgrade that raises them cannot quietly
    // let a pasted document spend longer laying out a hostile graph.
    maxTextSize: 50_000,
    maxEdges: 500,
  };
}

function isDarkTheme(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.documentElement;
  return (
    el.classList.contains("dark") ||
    el.getAttribute("data-theme") === "dark" ||
    document.querySelector('[data-md-preview][data-theme="dark"]') !== null
  );
}

export function DiagramPreview({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [themeVersion, setThemeVersion] = useState(0);

  // Re-render diagrams when the light/dark theme changes.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const obs = new MutationObserver(() => setThemeVersion((v) => v + 1));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const src = code.trim();
    const host = ref.current;
    if (!host) return;
    if (!src) {
      host.innerHTML = "";
      setError(null);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        if (language === "mermaid") {
          const mermaid = await getMermaid();
          mermaid.initialize(mermaidConfig(isDarkTheme()));
          // Unique id per render; mermaid injects a throwaway element itself.
          const id = "mmd-" + Math.floor(Math.random() * 1e9).toString(36);
          const { svg } = await mermaid.render(id, src);
          if (!cancelled && ref.current) {
            ref.current.innerHTML = svg;
            setError(null);
          }
        } else if (language === "abc") {
          const ABCJS = await getAbc();
          if (!cancelled && ref.current) {
            ref.current.innerHTML = "";
            ABCJS.renderAbc(ref.current, src, { responsive: "resize" });
            setError(null);
          }
        }
      } catch (e) {
        if (!cancelled) {
          // A renderer that could not be DOWNLOADED is not a mistake in the
          // diagram; saying "mermaid error: Failed to fetch dynamically imported
          // module …" sent people looking for a typo that was never there.
          setError(
            isChunkLoadError(e)
              ? (language === "abc" ? t("panes.musicRendererCouldntLoad") : t("panes.diagramRendererCouldntLoad"))
              : e instanceof Error ? e.message : String(e),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, language, themeVersion, t]);

  return (
    <div
      className="diagram-preview mt-1 rounded-md border border-border bg-card p-3"
      contentEditable={false}
      data-diagram={language}
    >
      {loading && !error ? (
        <div className="py-3 text-center text-xs text-muted-foreground" aria-live="polite">
          {language === "abc" ? t("panes.renderingScore") : t("panes.renderingDiagram")}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          <span className="font-medium">{t("panes.languageError", { language })}</span> {error}
        </div>
      ) : null}
      <div ref={ref} className="flex justify-center overflow-x-auto" />
    </div>
  );
}
