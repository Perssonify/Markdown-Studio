/**
 * Long-form copy (the Help page's sections, the About page's prose) is not in
 * the key catalog: it is content — paragraphs a translator rewrites whole,
 * not labels. Each such module exports a map from locale to that locale's
 * version, with English required, and the page renders
 * `localizedContent(map)`. A translation is a new entry in the map; the
 * renderer does not change.
 */
import { getLocale } from "./core";

export type LocalizedContent<T> = { readonly en: T } & Readonly<Partial<Record<string, T>>>;

/** The version for the interface language: exact, then base language, then English. */
export function localizedContent<T>(content: LocalizedContent<T>, locale: string = getLocale()): T {
  const base = locale.split(/[-_]/)[0] ?? locale;
  return content[locale] ?? content[base] ?? content.en;
}
