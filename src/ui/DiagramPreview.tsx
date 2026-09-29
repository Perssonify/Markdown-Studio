import { useEffect, useRef, useState } from "react";

/**
 * Lazy-loaded live preview for fenced code blocks whose language is a diagram
 * or music notation. Mermaid and abcjs are heavy, so they're dynamically
 * imported only when such a block actually appears (kept out of the main bundle).
 * The fenced source stays editable in the code block above; this is preview-only,
 * so ```mermaid / ```abc round-trip to Markdown for free.
 */

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
async function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

let abcPromise: Promise<typeof import("abcjs")> | null = null;
async function getAbc() {
  if (!abcPromise) abcPromise = import("abcjs");
  const mod = await abcPromise;
  return (mod as { default?: typeof import("abcjs") }).default ?? mod;
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
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: isDarkTheme() ? "dark" : "default",
          });
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
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, language, themeVersion]);

  return (
    <div
      className="diagram-preview mt-1 rounded-md border border-border bg-card p-3"
      contentEditable={false}
      data-diagram={language}
    >
      {loading && !error ? (
        <div className="py-3 text-center text-xs text-muted-foreground" aria-live="polite">
          Rendering {language === "abc" ? "score" : "diagram"}…
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
        >
          <span className="font-medium">{language} error:</span> {error}
        </div>
      ) : null}
      <div ref={ref} className="flex justify-center overflow-x-auto" />
    </div>
  );
}
