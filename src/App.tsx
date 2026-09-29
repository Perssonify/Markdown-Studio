import { useTheme } from "next-themes";
import React, { Suspense, useCallback, useEffect, useState } from "react";
import { useAppRouter } from "./app/router";
import { APP_NAME, MODES } from "./constants";
import { useUIStore } from "./store/uiStore";
import { DEFAULT_CONTENT } from "./constants";
import { STARTER_DOCUMENTS } from "./data/starter-documents";
import { EditorHeader } from "./EditorHeader";
import { ErrorBoundary, PerssonifyEditor } from "./index";
import { setToastsMutedForInteriorPage } from "./ui/Toast";

const AboutPage = React.lazy(() => import("./ui/pages/AboutPage").then((m) => ({ default: m.AboutPage })));
const HelpPage = React.lazy(() => import("./ui/pages/HelpPage").then((m) => ({ default: m.HelpPage })));
const Walkthrough = React.lazy(() => import("./ui/Walkthrough").then((m) => ({ default: m.Walkthrough })));

const TOUR_SEEN_KEY = "pf:tour-seen-v1";

export function App() {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark" || resolvedTheme === undefined;
    const { route, navigate } = useAppRouter();
    const [tourRun, setTourRun] = useState(false);
    /** Source URL from `?import_url=`, handed to the editor to pre-fill (never
     *  auto-fetch) the importer. Read DURING RENDER, not in the param effect
     *  below: effects run after the editor's first render, so a seed set there
     *  would arrive too late to open the importer with. The effect still strips
     *  the parameter from the address bar. */
    const [importUrlSeed] = useState<string | undefined>(() => {
        if (typeof window === "undefined") return undefined;
        try { return new URLSearchParams(window.location.search).get("import_url") || undefined; }
        catch { return undefined; }
    });

    // Config deep-links: apply ?ads=, ?readonly=, and ?view_mode= (md|html|split)
    // on load, then strip them from the URL. `ads`/`readonly` are applied for the
    // SESSION only — via setState, which bypasses the persisting setters — so
    // opening a shared read-only/ads link doesn't overwrite the visitor's own
    // saved settings on later normal visits. The standalone app's counterpart to
    // embed.tsx's param block.
    useEffect(() => {
        let params: URLSearchParams;
        try { params = new URLSearchParams(window.location.search); } catch { return; }
        if (![...params.keys()].some((k) => k === "ads" || k === "readonly" || k === "view_mode" || k === "import_url")) return;
        const store = useUIStore.getState();
        const ads = params.get("ads");
        if (ads !== null) useUIStore.setState({ showAds: ads === "true" || ads === "1" });
        const ro = params.get("readonly");
        if (ro !== null) useUIStore.setState({ readOnly: ro === "true" || ro === "1" });
        const vm = params.get("view_mode");
        if (vm === "md" || vm === "html" || vm === "split") {
            store.setMode(vm === "md" ? MODES.MD : vm === "html" ? MODES.HTML : MODES.SPLIT);
            // PerssonifyEditor's prefs-load runs AFTER this (it awaits IndexedDB)
            // and calls setMode(prefs/initialMode), which would clobber the mode we
            // just applied — and by then view_mode is stripped from the URL, so it
            // can't re-read it. Hand the intent off via sessionStorage so PE's init
            // honors it instead of overriding. (One-shot: PE clears it after use.)
            try { sessionStorage.setItem("pf:session-view-mode", vm); } catch { /* ignore */ }
        }
        // `?import_url=` is read during render (see importUrlSeed above) and only
        // stripped here. It PRE-FILLS the importer and never fetches on its own,
        // so a shared link cannot make the visitor's browser hit an
        // attacker-chosen address on load. It is handled in the app shell rather
        // than inside the editor because URL params are the shell's job — a
        // library consumer must not have their own page's query string silently
        // open dialogs inside an embedded editor.
        params.delete("ads"); params.delete("readonly"); params.delete("view_mode"); params.delete("import_url");
        const qs = params.toString();
        try {
            window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
        } catch { /* ignore */ }
    }, []);

    // Start the guided tour — return to the editor first so its targets are on
    // screen, then run on the next frame.
    const startTour = useCallback(() => {
        navigate("editor");
        requestAnimationFrame(() => setTourRun(true));
    }, [navigate]);

    const finishTour = useCallback(() => {
        setTourRun(false);
        try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch { /* ignore */ }
    }, []);

    // Auto-run the tour once, on a first visit that lands on the editor.
    // IMPORTANT: wait until the editor UI actually exists before starting —
    // the editor shows a target-less loading screen while IndexedDB/engine
    // chunks initialize, and starting the tour then made it "finish" instantly
    // (zero targets found) and permanently mark itself as seen without ever
    // being shown. Poll for a real tour anchor; never write the seen-flag if
    // the UI never appeared.
    useEffect(() => {
        if (route !== "editor") return;
        let seen = true;
        try { seen = localStorage.getItem(TOUR_SEEN_KEY) === "1"; } catch { /* ignore */ }
        if (seen) return;
        let cancelled = false;
        const start = Date.now();
        const poll = () => {
            if (cancelled) return;
            if (document.querySelector('[data-tour="menubar"]')) {
                // UI is up — small beat so the layout settles, then run.
                setTimeout(() => { if (!cancelled) setTourRun(true); }, 600);
                return;
            }
            if (Date.now() - start > 30_000) return; // give up silently; try again next visit
            setTimeout(poll, 250);
        };
        const t = setTimeout(poll, 400);
        return () => { cancelled = true; clearTimeout(t); };
    }, [route]);

    // Mute editor lifecycle toasts while a static interior page covers the
    // editor — "Ready" popping over the Help docs reads as a malfunction.
    useEffect(() => {
        setToastsMutedForInteriorPage(route === "about" || route === "help");
        return () => setToastsMutedForInteriorPage(false);
    }, [route]);

    // Leaving the editor (e.g. browser Back to /help) while the tour is running
    // would strand the spotlight above the wrong page — end it cleanly instead.
    useEffect(() => {
        if (route !== "editor" && tourRun) finishTour();
    }, [route, tourRun, finishTour]);

    // F9: keep the browser tab / history entry meaningful. Without this every
    // route and document shared one static <title>.
    useEffect(() => {
        const base = APP_NAME;
        document.title =
            route === "about" ? `About · ${base}`
            : route === "help" ? `Help · ${base}`
            : route === "graph" ? `Relationship map · ${base}`
            : base;
    }, [route]);

    return (
        <ErrorBoundary isDark={isDark}>
          {/* Viewport-locked shell: header + editor must sum to exactly 100dvh.
              Without this the editor alone was viewport-height, the page gained
              a scrollbar of exactly the header height, and any caret scroll
              drifted the whole chrome off-screen (clipped header/status bar).
              EXCEPT below ~450px of viewport height (400% zoom, a landscape
              phone), where the lock left the editor zero pixels: `pf-shell`
              lets the page scroll there instead (A091, styles.css). */}
          <div className="pf-shell pf-safe-x flex h-dvh flex-col overflow-hidden">
            <div className="shrink-0" data-print-hide>
                <EditorHeader />
            </div>
            <div className="pf-shell-editor min-h-0 flex-1">
            <PerssonifyEditor
                fitParent
                initialMode="split"
                initialDocument={{
                    title: "Welcome",
                    content: DEFAULT_CONTENT,
                }}
                // First-run companions (Changelog + a foldered About Perssonify),
                // linked to/from the welcome doc so the relationship map opens on
                // an actual graph rather than one unconnected dot.
                starterDocuments={STARTER_DOCUMENTS.map((d) => ({
                    markdown: d.markdown,
                    folderPath: d.folderPath,
                }))}
                onAbout={() => navigate("about")}
                onHelp={() => navigate("help")}
                onStartTour={startTour}
                initialImportUrl={importUrlSeed}
                graphOpen={route === "graph"}
                // Opening the graph pushes (so browser Back closes it); closing
                // REPLACES the /graph entry — otherwise every toggle stacked two
                // history entries and Back ping-ponged through old graph visits.
                onGraphOpenChange={(open) => navigate(open ? "graph" : "editor", open ? undefined : { replace: true })}
            />
            </div>
          </div>

            <Suspense fallback={null}>
                {route === "about" && <AboutPage onClose={() => navigate("editor")} />}
                {route === "help" && <HelpPage onClose={() => navigate("editor")} onStartTour={startTour} />}
                {tourRun && <Walkthrough run={tourRun} onFinish={finishTour} />}
            </Suspense>
        </ErrorBoundary>
    );
}
