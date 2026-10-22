/**
 * The visitor's answer about analytics cookies.
 *
 * Every visitor, everywhere, is asked (the bar in src/app/analyticsConsent),
 * and nothing is stored before the answer. Library-safe: no Google code lives
 * here. The app shell's utils/analytics.ts registers what an answer DOES
 * (`registerAnalytics`); where nothing has registered — the iframe embed, the
 * npm library, every build but the production app — neither the prompt nor the
 * Settings ▸ Privacy switch shows.
 */
import { safeStorage } from "./safe-storage";

export const ANALYTICS_CONSENT_KEY = "pf:analytics-consent";
export type AnalyticsConsent = "granted" | "denied";

let apply: ((consent: AnalyticsConsent) => void) | null = null;
const listeners = new Set<() => void>();

export function analyticsConsent(): AnalyticsConsent | null {
  const v = safeStorage.get(ANALYTICS_CONSENT_KEY);
  return v === "granted" || v === "denied" ? v : null;
}

/** For `useSyncExternalStore`: the prompts and Settings follow each other. */
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

/** Whether the consent prompt is due: analytics runs here and the visitor has not answered. */
export function consentPromptNeeded(): boolean {
  return apply !== null && analyticsConsent() === null;
}

/** Record the visitor's answer, apply it now and tell the prompts and Settings. */
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
