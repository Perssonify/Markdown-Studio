/**
 * Google Analytics 4 for the standalone app (markdownstudio.com).
 *
 * Only the production deploy on Vercel turns it on (`__PF_ANALYTICS__`, set in
 * vite.app.config.ts from VERCEL_ENV): previews, local and e2e builds and the
 * dev server never load it, and neither do the iframe embed or the npm
 * library, which do not run main.tsx and never import this file (Settings
 * reads utils/analytics-consent.ts, which holds no Google code). The e2e
 * suites fail on any console error, and a gtag.js that cannot be fetched
 * prints one.
 *
 * main.tsx installs it AFTER setting `__PF_BOOTED`. Ad blockers routinely block
 * gtag.js, and index.html's boot watchdog takes a <script> that failed to load
 * before boot for a broken deploy: it would delete the offline caches and
 * reload.
 *
 * What Google is told about a page is the route's own path and title, never
 * the address bar: `#share=` carries the shared documents themselves, `#live=`
 * the id that IS a live share's permission, and `?import_url=` the address a
 * user imports from. The config sends no page view of its own; App.tsx reports
 * each route (`trackPageView`) after it has set the route's title. Document
 * names never reach `document.title`.
 *
 * Consent (Google's Consent Mode; the answer is utils/analytics-consent.ts):
 *  - Every visitor, in every country, is asked. Until they answer, gtag.js
 *    has every storage type denied: no cookies, only cookieless pings.
 *  - "denied" stops gtag.js at once and removes its cookies; from the next
 *    load it is not loaded at all. "granted" allows analytics cookies, never
 *    advertising ones.
 */
import { analyticsConsent, registerAnalytics, type AnalyticsConsent } from "./analytics-consent";

/**
 * The GA4 web stream for markdownstudio.com. The id is written out in each
 * string: the minifier keeps a template literal's interpolation, which left
 * the id in every build.
 */
export const GA_MEASUREMENT_ID = "G-WFN9X3MKR0";
export const GTAG_SRC = "https://www.googletagmanager.com/gtag/js?id=G-WFN9X3MKR0";

/** Google's documented per-property switch: while it is true, gtag.js sends nothing. */
export const GA_DISABLE_KEY = "ga-disable-G-WFN9X3MKR0";

const DENIED = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
};

declare const __PF_ANALYTICS__: boolean | undefined;

/** Whether this build reports to Google Analytics (false in tests and every other build). */
export const ANALYTICS_BUILD = typeof __PF_ANALYTICS__ !== "undefined" && __PF_ANALYTICS__ === true;

type Gtag = (...args: unknown[]) => void;

let gtag: Gtag | null = null;

/**
 * Offer the consent choice on this page and, unless the visitor has said no,
 * load gtag.js. Returns whether analytics is running. Never throws.
 */
export function installAnalytics(enabled: boolean = ANALYTICS_BUILD): boolean {
  if (!enabled || typeof window === "undefined" || typeof document === "undefined") return false;
  registerAnalytics(applyConsent);
  return analyticsConsent() !== "denied" && loadGtag();
}

/**
 * Queue gtag's consent defaults and config and add gtag.js — Google's snippet,
 * run from the bundle so the CSP needs no hash for it. Apart from
 * installAnalytics so that nothing calls back into it: that cycle kept all of
 * this in every build, where main.tsx's `if` should leave it out.
 */
function loadGtag(): boolean {
  if (gtag) return true;
  const consent = analyticsConsent();
  try {
    const w = window as unknown as { dataLayer?: unknown[] };
    const dataLayer = (w.dataLayer = w.dataLayer || []);
    gtag = function () {
      // gtag.js only takes an `arguments` object for a command, never an array.
      // eslint-disable-next-line prefer-rest-params
      dataLayer.push(arguments);
    };
    // Before the config, so gtag.js never sets a cookie it was not allowed to.
    gtag("consent", "default", DENIED);
    if (consent === "granted") gtag("consent", "update", { analytics_storage: "granted" });
    gtag("js", new Date());
    gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
    const script = document.createElement("script");
    script.async = true;
    script.src = GTAG_SRC;
    document.head.appendChild(script);
    return true;
  } catch {
    return false;
  }
}

/**
 * An answer, applied now. "denied" stops gtag.js and removes Google's cookies;
 * "granted" allows analytics cookies, starting analytics first if an earlier
 * "denied" kept it from loading.
 */
function applyConsent(consent: AnalyticsConsent): void {
  (window as unknown as Record<string, unknown>)[GA_DISABLE_KEY] = consent === "denied";
  if (consent === "denied") {
    gtag?.("consent", "update", DENIED);
    clearGaCookies();
  } else if (gtag) {
    gtag("consent", "update", { analytics_storage: "granted" });
  } else {
    loadGtag();
  }
}

/**
 * gtag.js sets `_ga` and `_ga_<stream>` on the widest domain it may
 * (".markdownstudio.com"), and a cookie is removed only by naming its domain,
 * so each parent domain of this host is tried.
 */
function clearGaCookies(): void {
  const labels = window.location.hostname.split(".");
  for (const c of document.cookie.split(";")) {
    const name = (c.split("=")[0] ?? "").trim();
    if (name !== "_ga" && !name.startsWith("_ga_")) continue;
    document.cookie = `${name}=; Max-Age=0; path=/`;
    for (let i = 0; i < labels.length - 1; i++) {
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${labels.slice(i).join(".")}`;
    }
  }
}

/**
 * Report a page view for the route at `path` ("/", "/about", …), titled with
 * the current `document.title`. `set` also stamps the route on the events
 * gtag.js sends by itself (scrolls, engagement), so none of them carry the
 * address bar either. A no-op until `installAnalytics` has run, and once the
 * visitor has said no.
 */
export function trackPageView(path: string): void {
  if (!gtag || analyticsConsent() === "denied") return;
  try {
    gtag("set", { page_location: window.location.origin + path, page_title: document.title });
    gtag("event", "page_view");
  } catch { /* analytics must never break the app */ }
}

/** Test hook: forget an install. */
export function _resetAnalyticsForTests(): void {
  gtag = null;
}
