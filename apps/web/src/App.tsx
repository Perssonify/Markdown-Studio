import { useTheme } from "next-themes";
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { accountsEnabled, useAccount } from "./app/account/account";
import { AccountCheckScreen } from "./app/account/accountCheckScreen";
import { AccountMenu } from "./app/account/accountMenu";
import { SignInNudge } from "./app/account/signInNudge";
import { AnalyticsConsentBar } from "./app/analyticsConsent";
import { prepareCloudLibrary, startCloudSync, useCloudStatus } from "./app/cloud";
import { liveSharesApi, prepareLiveLink, readLiveSeed, startFollowing, type LiveLinkOutcome } from "./app/publish";
import { routeToPath, useAppRouter } from "./app/router";
import { APP_NAME, MODES } from "./constants";
import { useUIStore } from "./store/preferences/uiStore";
import { readSharePayloadFromHash, type ShareView } from "./store/importExport/share-link";
import { toast as toastSonner } from "sonner";
import { DEFAULT_CONTENT } from "./constants";
import { STARTER_DOCUMENTS } from "./data/starter-documents";
import { EditorHeader } from "./EditorHeader";
import { localeDir, setLocale, useLocale, useT } from "./i18n";
import { ErrorBoundary, PerssonifyEditor } from "./index";
import { SkipToEditor } from "./ui/shared/skipToEditor";
import { setToastsMutedForInteriorPage } from "./ui/shared/toast";
import { trackPageView } from "./utils/analytics";
import { sessionAdsFromParam } from "./utils/build-gates";
import { installRemoteImagePolicy } from "./utils/remote-images";
import { assetStore } from "./store/assets/asset-store";

// Settings ▸ Privacy ▸ "Block remote images" is enforced as an img-src policy
// for THIS page, and must be in force before any document renders — hence
// module scope, not an effect. The app shell owns its document; the library
// never does this (it must not restrict its host page).
installRemoteImagePolicy();

// `?lang=<locale>` shows the interface in that language for THIS page load
// only — like `readonly`, it must not overwrite the visitor's saved choice
// (A099). Module scope, so the very first render is already in it; the param
// effect below strips it from the address bar with the others. Only a
// language this build can show is honoured: the `en-XA` pseudo-locale exists
// in development builds alone, and a production build reads it as English.
try {
    const lang = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("lang");
    if (lang) setLocale(lang, { persist: false });
} catch { /* no URL: nothing to apply */ }

// Pasted and imported images are stored ONCE, as binary assets, instead of as
// base64 inside every document, snapshot, stash and projection (A086). The app
// shell turns this on for itself; a library host or the iframe embed opts in
// through `storageConfig.assets`, because the content a host reads back out
// would otherwise refer to images it cannot resolve (see configureLocalStores).
assetStore.configure({ enabled: true });

const AboutPage = React.lazy(() => import("./ui/pages/aboutPage").then((m) => ({ default: m.AboutPage })));
const HelpPage = React.lazy(() => import("./ui/pages/helpPage").then((m) => ({ default: m.HelpPage })));
const LoginPage = React.lazy(() => import("./ui/pages/loginPage").then((m) => ({ default: m.LoginPage })));
const ProfilePage = React.lazy(() => import("./ui/pages/profilePage").then((m) => ({ default: m.ProfilePage })));
const Walkthrough = React.lazy(() => import("./ui/tour/walkthrough").then((m) => ({ default: m.Walkthrough })));

const TOUR_SEEN_KEY = "pf:tour-seen-v1";

export function App() {
    const t = useT();
    const locale = useLocale();
    // The page speaks the interface language (A099): `lang` for screen readers,
    // hyphenation and fonts, `dir` for a right-to-left catalog. Before paint,
    // so a right-to-left interface never flashes left-to-right. The app shell
    // owns its document; the library and the embed never touch their host's.
    useLayoutEffect(() => {
        document.documentElement.lang = locale;
        document.documentElement.dir = localeDir(locale);
    }, [locale]);
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
    /** A self-contained share link (`#share=…`) the visitor opened: its documents,
     *  decoded during render so the editor can import them on boot. Captured here
     *  (not in an effect) before the `#share=` is stripped from the address below. */
    const [shareSeed] = useState(() => {
        if (typeof window === "undefined") return undefined;
        return readSharePayloadFromHash() ?? undefined;
    });
    /** A LIVE share link (`#live=<id>`): fetched before the editor opens — it
     *  is imported as a followed copy, or the copy followed here is opened
     *  (app/publish). Only in builds with the account server, which serves it. */
    const [liveSeed] = useState(() => (accountsEnabled() ? readLiveSeed() : null));
    const [liveOutcome, setLiveOutcome] = useState<LiveLinkOutcome | null>(null);
    useEffect(() => {
        if (!liveSeed) return;
        let cancelled = false;
        void prepareLiveLink(liveSeed.id, liveSeed.view).then((o) => { if (!cancelled) setLiveOutcome(o); });
        return () => { cancelled = true; };
    }, [liveSeed]);
    // A live link that could not be opened says so once the editor (and its
    // toasts) is up — the editor opens normally underneath.
    useEffect(() => {
        if (liveOutcome?.kind !== "failed") return;
        const message = liveOutcome.gone ? t("account.liveShareGone") : t("account.liveShareUnreachable");
        const show = () => { setTimeout(() => toastSonner.error(message, { duration: 6000 }), 400); };
        if (useUIStore.getState().editorReady) { show(); return; }
        const unsub = useUIStore.subscribe((s) => { if (s.editorReady) { unsub(); show(); } });
        return unsub;
    }, [liveOutcome, t]);
    // The layout a shared link asks for (`view`), for this visit only — the
    // same hand-off to the editor's boot as `?view_mode=` below.
    useEffect(() => {
        const view: ShareView | undefined = shareSeed?.view ?? liveSeed?.view;
        if (!view) return;
        useUIStore.getState().setMode(view === "md" ? MODES.MD : view === "html" ? MODES.HTML : MODES.SPLIT);
        try { sessionStorage.setItem("pf:session-view-mode", view); } catch { /* ignore */ }
    }, [shareSeed, liveSeed]);

    // Config deep-links: apply ?ads=, ?readonly=, and ?view_mode= (md|html|split)
    // on load, then strip them from the URL. `ads`/`readonly` are applied for the
    // SESSION only — via setState, which bypasses the persisting setters — so
    // opening a shared read-only/ads link doesn't overwrite the visitor's own
    // saved settings on later normal visits. The standalone app's counterpart to
    // embed.tsx's param block. `ads` is honoured in DEVELOPMENT builds only
    // (sessionAdsFromParam) — a crafted `?ads=1` link must not dress a
    // production build in placeholder ad slots — but it is stripped either way.
    useEffect(() => {
        let params: URLSearchParams;
        try { params = new URLSearchParams(window.location.search); } catch { return; }
        if (![...params.keys()].some((k) => k === "ads" || k === "readonly" || k === "view_mode" || k === "import_url" || k === "lang")) return;
        const store = useUIStore.getState();
        const ads = sessionAdsFromParam(params.get("ads"));
        if (ads !== null) useUIStore.setState({ showAds: ads });
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
        params.delete("ads"); params.delete("readonly"); params.delete("view_mode"); params.delete("import_url"); params.delete("lang");
        const qs = params.toString();
        try {
            window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash);
        } catch { /* ignore */ }
    }, []);

    // Strip `#share=…` / `#live=…` (and its `view`) from the address after it
    // was captured (shareSeed, liveSeed), so a refresh does not import the
    // shared documents again. Any other hash is kept.
    useEffect(() => {
        if (typeof window === "undefined" || !/[#&](share|live)=/.test(window.location.hash)) return;
        try {
            const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
            params.delete("share");
            params.delete("live");
            params.delete("view");
            const rest = params.toString();
            window.history.replaceState({}, "", window.location.pathname + window.location.search + (rest ? `#${rest}` : ""));
        } catch { /* ignore */ }
    }, []);

    // Accounts (Google sign-in through the backend), in builds that have one
    // (accountsEnabled). Signing in is OPTIONAL: every visitor gets the editor,
    // with the notes in this browser, and signing in (the header's Sign in, or
    // the SignInNudge once they have notes of their own) adds sync across
    // devices and the daily backup. Builds without accounts make no account
    // call and show no account UI.
    const [accounts] = useState(accountsEnabled);
    const accountStatus = useAccount((s) => s.status);
    const accountUserId = useAccount((s) => s.user?.id ?? null);
    const cloudPhase = useCloudStatus((s) => s.phase);
    // Cloud sync for the signed-in account. Before the editor opens, the
    // library here is made ready: claimed for the account, and — when it is
    // empty (a new device, a wiped browser) — filled from the account first, so
    // the editor opens on the user's documents instead of seeding starter notes.
    const [cloudReadyFor, setCloudReadyFor] = useState<string | null>(null);
    useEffect(() => {
        if (!accounts || accountStatus !== "signed-in" || !accountUserId) return;
        let cancelled = false;
        let stop: (() => void) | null = null;
        void prepareCloudLibrary(accountUserId).then((outcome) => {
            if (cancelled) return;
            setCloudReadyFor(accountUserId);
            if (outcome === "ready") stop = startCloudSync(accountUserId);
        });
        return () => {
            cancelled = true;
            stop?.();
        };
    }, [accounts, accountStatus, accountUserId]);
    useEffect(() => {
        if (accounts) void useAccount.getState().refresh();
    }, [accounts]);
    // Live documents followed in this browser: kept up to date while the app
    // is open, signed in or not (app/publish).
    useEffect(() => (accounts ? startFollowing() : undefined), [accounts]);
    useEffect(() => {
        if (!accounts && (route === "login" || route === "profile")) navigate("editor", { replace: true });
    }, [accounts, route, navigate]);

    // The account control at the right end of the top header. One element for
    // the life of the shell: a fresh element each render would needlessly
    // re-render the account menu subtree on every App render.
    const accountControl = useMemo(
        () => (accounts ? <AccountMenu onSignIn={() => navigate("login")} onProfile={() => navigate("profile")} /> : undefined),
        [accounts, navigate]
    );

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
        setToastsMutedForInteriorPage(route === "about" || route === "help" || route === "login" || route === "profile");
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
            route === "about" ? t("app.aboutTitle", { app: base })
            : route === "help" ? t("app.helpTitle", { app: base })
            : route === "graph" ? t("app.relationshipMapTitle", { app: base })
            : route === "login" ? t("account.loginDocumentTitle", { app: base })
            : route === "profile" ? t("account.profileDocumentTitle", { app: base })
            : base;
    }, [route, t]);

    // One Google Analytics page view per route, after the effect above has
    // titled it. The route's own path, never the address bar, which can carry
    // a share's documents (utils/analytics.ts). A no-op outside the production
    // deploy.
    useEffect(() => {
        trackPageView(routeToPath(route));
    }, [route]);

    // Until the session is known, and for a signed-in visitor until the library
    // here is ready for the account: a signed-in visitor on a new device must
    // open on their notes, not on freshly seeded first-visit notes.
    if (accounts && accountStatus === "loading") return <AccountCheckScreen />;
    if (liveSeed && !liveOutcome) return <AccountCheckScreen message={t("account.openingLiveShare")} />;
    if (accounts && accountStatus === "signed-in" && accountUserId && cloudReadyFor !== accountUserId) {
        return <AccountCheckScreen message={cloudPhase === "preparing" ? t("account.bringingDocuments") : undefined} />;
    }

    return (
        <ErrorBoundary isDark={isDark}>
          {/* First stop on the page (A094): past the header, menus, toolbar
              and library straight into the document. */}
          <SkipToEditor />
          {/* Viewport-locked shell: header + editor must sum to exactly 100dvh.
              Without this the editor alone was viewport-height, the page gained
              a scrollbar of exactly the header height, and any caret scroll
              drifted the whole chrome off-screen (clipped header/status bar).
              EXCEPT below ~450px of viewport height (400% zoom, a landscape
              phone), where the lock left the editor zero pixels: `pf-shell`
              lets the page scroll there instead (A091, styles.css). */}
          <div className="pf-shell pf-safe-x flex h-dvh flex-col overflow-hidden" lang={locale} dir={localeDir(locale)}>
            <div className="shrink-0" data-print-hide>
                <EditorHeader accountControl={accountControl} />
                <AnalyticsConsentBar />
                {accounts && route === "editor" && <SignInNudge onSignIn={() => navigate("login")} />}
            </div>
            <div className="pf-shell-editor min-h-0 flex-1">
            <PerssonifyEditor
                fitParent
                initialMode="split"
                initialDocument={{
                    title: "Welcome",
                    content: DEFAULT_CONTENT,
                }}
                // First-run companions (Changelog + a foldered Getting started),
                // linked to/from the welcome doc so the relationship map opens on
                // an actual graph rather than one unconnected dot.
                starterDocuments={STARTER_DOCUMENTS.map((d) => ({
                    markdown: d.markdown,
                    folderPath: d.folderPath,
                }))}
                onAbout={() => navigate("about")}
                onHelp={() => navigate("help")}
                onStartTour={startTour}
                // Backup reminders, the wiped-library explanation, the moved-
                // domain banner and the install tip: the app's own library,
                // so the app's own notices (an embedder's storage is theirs).
                durabilityNotices
                initialImportUrl={importUrlSeed}
                initialShare={shareSeed ?? (liveOutcome?.kind === "import" ? liveOutcome.share : undefined)}
                // Share links need an account: signed out, every share control
                // is greyed out and says so. Where no account service answers
                // (offline, an outage) there is nobody to sign in to, so sharing
                // stays as it was.
                shareDisabledReason={accounts && accountStatus === "signed-out" ? t("account.signInToShare") : undefined}
                // Live shares are published from the account: offered once signed in.
                liveShares={accounts && accountStatus === "signed-in" && cloudPhase !== "blocked" ? liveSharesApi : undefined}
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
                {route === "login" && <LoginPage onClose={() => navigate("editor")} onProfile={() => navigate("profile")} />}
                {route === "profile" && <ProfilePage onClose={() => navigate("editor")} onSignIn={() => navigate("login")} />}
                {tourRun && <Walkthrough run={tourRun} onFinish={finishTour} />}
            </Suspense>
        </ErrorBoundary>
    );
}
