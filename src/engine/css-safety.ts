/**
 * Guards for every value this app writes into a `style` attribute on behalf of
 * a document: an imported file, a pasted page, a host `updateDocument`, the
 * curly-brace markdown syntax. Pure string checks, so they run without a DOM
 * (SSR, the headless export path) and give the same answer everywhere.
 *
 * The rule is an ALLOWLIST. Earlier filters tried to name what was dangerous
 * (`position`, `url(`), and a CSS escape walked straight past them —
 * `posit\ion: fixed` and `u\rl(…)` mean exactly what they look like they do not
 * — so nothing here decodes, it refuses: a property must be a plain lowercase
 * name on the list, and a value may not contain a backslash, a function call
 * (other than a colour function vetted by `sanitizeCssColor`), a comment,
 * brackets or angle brackets.
 */
import { sanitizeCssColor } from "../theme/palette";

export { sanitizeCssColor };

/** A font-family list: names, quoted names and commas — nothing that can end
 *  the declaration, open a function or escape a character. */
export function sanitizeFontFamily(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > 200) return undefined;
  return /^[\p{L}\p{N}\s,'"_.-]+$/u.test(s) ? s : undefined;
}

export const TEXT_ALIGNMENTS: readonly string[] = ["left", "center", "right", "justify"];

export function sanitizeTextAlign(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().toLowerCase();
  return TEXT_ALIGNMENTS.includes(s) ? s : undefined;
}

/**
 * Declarations the editor round-trips or that the app's own pipeline writes
 * (the preview's list styling, TipTap's table column widths). Everything that
 * positions, transforms, fetches or hides content is absent by construction.
 */
export const INLINE_STYLE_ALLOWLIST: ReadonlySet<string> = new Set([
  "color", "background-color",
  "font-family", "font-size", "font-weight", "font-style",
  "text-decoration", "text-decoration-line", "text-align", "vertical-align",
  "line-height", "letter-spacing",
  "list-style", "list-style-type", "list-style-position",
  "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
  "padding", "padding-left",
  "display", "width", "min-width", "max-width", "height",
]);

const DISPLAY_VALUES = new Set(["block", "inline", "inline-block", "list-item"]);
/** Keywords, numbers, lengths, percentages, #hex: no parentheses, quotes or escapes. */
const PLAIN_VALUE = /^[a-zA-Z0-9\s.,%#+-]+$/;

/** One declaration's value, vetted for its property; undefined to drop it. */
export function sanitizeStyleValue(prop: string, value: string): string | undefined {
  const v = value.trim().replace(/\s*!important$/i, "");
  if (!v || v.length > 200) return undefined;
  switch (prop) {
    case "color":
    case "background-color":
      return sanitizeCssColor(v);
    case "font-family":
      return sanitizeFontFamily(v);
    case "text-align":
      return sanitizeTextAlign(v);
    case "display":
      return DISPLAY_VALUES.has(v.toLowerCase()) ? v.toLowerCase() : undefined;
    default:
      return PLAIN_VALUE.test(v) ? v : undefined;
  }
}

/** Split on `;` outside quotes and parentheses. */
function splitDeclarations(style: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < style.length; i++) {
    const c = style[i];
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      out.push(style.slice(start, i));
      start = i + 1;
    }
  }
  out.push(style.slice(start));
  return out;
}

/**
 * Keep the allowlisted declarations whose values are inert; returns "" when
 * nothing survives. `background: <colour>` is kept as `background-color` —
 * the shorthand itself can carry an image, but a pasted highlight usually
 * arrives spelled that way.
 */
export function sanitizeStyleDeclarations(
  style: string,
  allowed: ReadonlySet<string> = INLINE_STYLE_ALLOWLIST,
): string {
  if (!style) return "";
  const kept: string[] = [];
  for (const decl of splitDeclarations(style)) {
    const idx = decl.indexOf(":");
    if (idx < 0) continue;
    let prop = decl.slice(0, idx).trim().toLowerCase();
    const raw = decl.slice(idx + 1);
    // A plain name only: this is what rejects `posit\ion` and friends.
    if (!/^[a-z][a-z-]*$/.test(prop)) continue;
    // Anything that can hide or fetch, whatever the property. (Belt and
    // braces: each per-property validator below also refuses a backslash, a
    // bracket and a function call — this line keeps that true for a property
    // added later with a looser validator.)
    if (/[\\<>{}]|\/\*|url\s*\(|image-set\s*\(|expression\s*\(|@import|behavior|-moz-binding|javascript:/i.test(raw)) continue;
    if (prop === "background" && sanitizeCssColor(raw.trim())) prop = "background-color";
    if (!allowed.has(prop)) continue;
    const value = sanitizeStyleValue(prop, raw);
    if (value) kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

/** Escape a value for a double-quoted HTML attribute (`&` first). */
export function escapeAttr(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
