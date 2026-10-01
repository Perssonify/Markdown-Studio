/**
 * Message shapes shared by the catalogs and the runtime (kept apart from
 * `core.ts` so a catalog can import them without a cycle).
 */

/**
 * A message that depends on a number. One form per CLDR plural category the
 * language uses (`Intl.PluralRules`); `other` is required because every
 * language has it. `zero`, when given, also wins for exactly 0 in languages
 * whose rules have no zero category (English "No links" instead of "0 links").
 * The number is passed as the `count` variable.
 */
export interface PluralMessage {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/** A catalog entry: plain text with `{name}` placeholders, or a plural set. */
export type Message = string | PluralMessage;

/** Values for `{name}` placeholders. Numbers are inserted as `String(n)`. */
export type Vars = Readonly<Record<string, string | number>>;
