/**
 * The translation layer (A099), without React — safe for stores, toasts and
 * anything else that is not a component. Components use `useT()` from
 * `./react`, which re-renders them when the language changes.
 *
 * English (`en.ts`) is the source of truth: `MessageKey` is derived from it, so
 * a key that does not exist there is a type error at the call site. Another
 * language is a catalog of the same keys; any key it lacks falls back to
 * English rather than showing a raw key.
 *
 * The language is chosen once, lazily, the first time anything asks: the
 * stored `pf:locale` preference, then `navigator.language`, then English —
 * and only a language that has a catalog can be chosen. Today that is English,
 * plus the `en-XA` pseudo-locale in development builds (`pseudo.ts`).
 */
import { safeStorage } from "../utils/safe-storage";
import { buildFlags } from "../utils/build-gates";
import { en, type MessageKey } from "./en";
import { pseudoMessage } from "./pseudo";
import type { Message, PluralMessage, Vars } from "./types";

export type { MessageKey } from "./en";
export type { Message, PluralMessage, Vars } from "./types";

export interface LocaleInfo {
  /** BCP 47 tag, as written to `lang` and to the `pf:locale` preference. */
  id: string;
  /** The language's name for itself, as the language picker shows it. */
  name: string;
  /** Writing direction of the INTERFACE in this language. */
  dir: "ltr" | "rtl";
  /** Translations. A key a catalog lacks falls back to English. */
  messages: Partial<Record<MessageKey, Message>>;
}

/**
 * The shipped languages. Adding one is a catalog file plus a line here
 * (docs/i18n.md).
 */
const CATALOGS: Record<string, LocaleInfo> = {
  en: { id: "en", name: "English", dir: "ltr", messages: en },
};

/** Development-only pseudo-locale: accented, lengthened, bracketed English. */
export const PSEUDO_LOCALE = "en-XA";
const PSEUDO_INFO: LocaleInfo = { id: PSEUDO_LOCALE, name: "Pseudo-locale (en-XA)", dir: "ltr", messages: {} };

export const DEFAULT_LOCALE = "en";

/** The persisted preference (a locale id). Absent means "follow the browser". */
export const LOCALE_PREF_KEY = "pf:locale";

/** Every language that can be chosen in this build. */
export function availableLocales(): LocaleInfo[] {
  const shipped = Object.values(CATALOGS);
  return buildFlags.dev ? [...shipped, PSEUDO_INFO] : shipped;
}

/**
 * The selectable locale a tag means, or null. An exact match wins, then the
 * base language ("en-GB" → "en"), so a regional browser setting still finds
 * its language.
 */
export function matchLocale(tag: string | null | undefined): string | null {
  if (!tag) return null;
  const want = tag.trim().toLowerCase();
  if (!want) return null;
  const ids = availableLocales().map((l) => l.id);
  const exact = ids.find((id) => id.toLowerCase() === want);
  if (exact) return exact;
  const base = want.split(/[-_]/)[0];
  return ids.find((id) => id.toLowerCase() === base) ?? null;
}

function browserLanguage(): string | null {
  try {
    return typeof navigator === "undefined" ? null : navigator.language || null;
  } catch {
    return null;
  }
}

/** `pf:locale`, then `navigator.language`, then English. */
export function resolveInitialLocale(): string {
  return matchLocale(safeStorage.get(LOCALE_PREF_KEY)) ?? matchLocale(browserLanguage()) ?? DEFAULT_LOCALE;
}

let current: string | null = null;
const listeners = new Set<() => void>();

/** The interface language now in force. */
export function getLocale(): string {
  return (current ??= resolveInitialLocale());
}

/** Writing direction of a locale's interface ("ltr" for anything unknown). */
export function localeDir(locale: string = getLocale()): "ltr" | "rtl" {
  return CATALOGS[locale]?.dir ?? "ltr";
}

/**
 * Switch the interface language. Returns false (and changes nothing) for a
 * locale this build cannot show. `persist: false` applies it to this page
 * load only — how the app shell honours `?lang=` without overwriting the
 * visitor's saved choice.
 */
export function setLocale(locale: string, { persist = true }: { persist?: boolean } = {}): boolean {
  const next = matchLocale(locale);
  if (!next) return false;
  if (persist) safeStorage.set(LOCALE_PREF_KEY, next);
  if (next !== getLocale()) {
    current = next;
    for (const fn of [...listeners]) fn();
  }
  return true;
}

/** Called whenever the language changes. Returns the unsubscribe. */
export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const pseudoCache = new Map<MessageKey, Message>();

function lookup(key: MessageKey, locale: string): Message {
  // English first and cheapest: one property read.
  if (locale === DEFAULT_LOCALE) return en[key] ?? key;
  if (locale === PSEUDO_LOCALE) {
    let msg = pseudoCache.get(key);
    if (msg === undefined) {
      msg = pseudoMessage(en[key] ?? key);
      pseudoCache.set(key, msg);
    }
    return msg;
  }
  return CATALOGS[locale]?.messages[key] ?? en[key] ?? key;
}

const pluralRules = new Map<string, Intl.PluralRules | null>();

function pluralCategory(n: number, locale: string): string {
  let rules = pluralRules.get(locale);
  if (rules === undefined) {
    try {
      rules = new Intl.PluralRules(locale === PSEUDO_LOCALE ? DEFAULT_LOCALE : locale);
    } catch {
      rules = null;
    }
    pluralRules.set(locale, rules);
  }
  return rules ? rules.select(n) : n === 1 ? "one" : "other";
}

function pluralForm(msg: PluralMessage, count: unknown, locale: string): string {
  const n = typeof count === "number" ? count : Number(count);
  if (!Number.isFinite(n)) return msg.other;
  if (n === 0 && msg.zero !== undefined) return msg.zero;
  return msg[pluralCategory(n, locale) as keyof PluralMessage] ?? msg.other;
}

/** The text of a message for a count: itself, or the matching plural form. */
export function selectForm(msg: Message, count: unknown, locale: string = getLocale()): string {
  return typeof msg === "string" ? msg : pluralForm(msg, count, locale);
}

/** Pick the plural form (from `vars.count`) and fill `{name}` placeholders. */
export function formatMessage(msg: Message, vars?: Vars, locale: string = getLocale()): string {
  const text = selectForm(msg, vars?.["count"], locale);
  if (!vars || !text.includes("{")) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/** The raw catalog entry for a key in the current language (for rich text). */
export function messageFor(key: MessageKey): Message {
  return lookup(key, getLocale());
}

/**
 * Translate. `t("menu.file")`, `t("library.documentCount", { count: 3 })`.
 * Reads the language at call time, so it is never stale in a callback.
 */
export function t(key: MessageKey, vars?: Vars): string {
  const locale = getLocale();
  return formatMessage(lookup(key, locale), vars, locale);
}

/** Test hook: forget the chosen language and every cache. */
export function _resetLocaleForTests(): void {
  current = null;
  pseudoCache.clear();
  pluralRules.clear();
}

/**
 * Test hook: make a catalog selectable without shipping it (e.g. a
 * right-to-left one, which the product does not have yet). Returns the undo.
 */
export function _registerLocaleForTests(info: LocaleInfo): () => void {
  CATALOGS[info.id] = info;
  return () => {
    delete CATALOGS[info.id];
    if (current === info.id) current = null;
  };
}
