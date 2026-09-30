/**
 * Interface translation (A099). See docs/i18n.md.
 *
 *  - Components: `const t = useT();` then `t("key")`, `t("key", { count })`,
 *    `t.rich("key", { b: (s) => <b>{s}</b> })`.
 *  - Everything else (toasts in callbacks, stores): `t` from here, which reads
 *    the language at call time.
 */
export {
  availableLocales,
  DEFAULT_LOCALE,
  formatMessage,
  getLocale,
  LOCALE_PREF_KEY,
  localeDir,
  matchLocale,
  PSEUDO_LOCALE,
  resolveInitialLocale,
  setLocale,
  subscribeLocale,
  t,
  type LocaleInfo,
  type Message,
  type MessageKey,
  type PluralMessage,
  type Vars,
} from "./core";
export { localeAttributes, renderRich, translateRich, useLocale, useT, type RichPart, type RichParts, type Translate } from "./react";
export { localizedContent, type LocalizedContent } from "./content";
