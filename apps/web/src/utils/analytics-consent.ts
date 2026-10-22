/**
 * The visitor's answer about analytics cookies, and who is asked for one.
 *
 * Library-safe: no Google code lives here. The app shell's utils/analytics.ts
 * registers what an answer DOES (`registerAnalytics`); where nothing has
 * registered — the iframe embed, the npm library, every build but the
 * production app — neither the prompt nor the Settings ▸ Privacy switch shows.
 *
 * Who is asked: browsers whose time zone is in the EEA, the UK (with its
 * Crown dependencies and Gibraltar, all `Europe/` zones) or Switzerland. Google's Consent Mode places the visitor by IP address but
 * never tells the page, so the page goes by the time zone, and every wrong
 * guess is safe: an EU visitor on another time zone is not asked, and Google
 * still sets no cookies for them; anyone else on a European time zone is
 * simply asked.
 */
import { safeStorage } from "./safe-storage";

export const ANALYTICS_CONSENT_KEY = "pf:analytics-consent";
export type AnalyticsConsent = "granted" | "denied";

/** Those places' time zones outside `Europe/`: Cyprus, Spain's and Portugal's islands and Ceuta, Iceland, Svalbard and the EU's overseas regions. */
const CONSENT_ZONES_OUTSIDE_EUROPE = new Set([
  "Asia/Nicosia", "Asia/Famagusta",
  "Atlantic/Canary", "Atlantic/Madeira", "Atlantic/Azores", "Africa/Ceuta",
  "Atlantic/Reykjavik", "Arctic/Longyearbyen",
  "America/Cayenne", "America/Guadeloupe", "America/Martinique", "America/Marigot",
  "Indian/Reunion", "Indian/Mayotte",
]);

let apply: ((consent: AnalyticsConsent) => void) | null = null;
const listeners = new Set<() => void>();

function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * Whether a browser in `timeZone` is asked before analytics cookies are set.
 * A zone that hides the place (UTC, `Etc/…`, none — privacy browsers report
 * these) is asked too.
 */
export function inConsentZone(timeZone: string = currentTimeZone()): boolean {
  if (!timeZone || timeZone === "UTC" || timeZone.startsWith("Etc/")) return true;
  return timeZone.startsWith("Europe/") || CONSENT_ZONES_OUTSIDE_EUROPE.has(timeZone);
}

export function analyticsConsent(): AnalyticsConsent | null {
  const v = safeStorage.get(ANALYTICS_CONSENT_KEY);
  return v === "granted" || v === "denied" ? v : null;
}

/** For `useSyncExternalStore`: the prompt and Settings follow each other. */
export function subscribeAnalyticsConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by utils/analytics.ts once analytics runs on this page. */
export function registerAnalytics(applyConsent: (consent: AnalyticsConsent) => void): void {
  apply = applyConsent;
}

/** Whether this page runs analytics, so the prompt and the setting appear only where they do something. */
export function analyticsOffered(): boolean {
  return apply !== null;
}

/** Whether the consent prompt is due: analytics runs here, the visitor is in a consent zone and has not answered. */
export function consentPromptNeeded(): boolean {
  return apply !== null && analyticsConsent() === null && inConsentZone();
}

/** Record the visitor's answer, apply it now and tell the prompt and Settings. */
export function setAnalyticsConsent(consent: AnalyticsConsent): void {
  safeStorage.set(ANALYTICS_CONSENT_KEY, consent);
  try {
    apply?.(consent);
  } catch { /* the answer is stored; it applies from the next load */ }
  for (const listener of listeners) listener();
}

/** Test hook: forget a registration. */
export function _resetAnalyticsConsentForTests(): void {
  apply = null;
}
