import { IS_MAC } from "../data/shortcuts";

/**
 * AltGr is how most of the world TYPES. German, Nordic, Swiss, Spanish, French
 * and Italian layouts put `[` `]` `{` `}` `\` `|` `@` `~` on it; Hungarian,
 * Czech and Croatian type `[` / `]` as AltGr+F / AltGr+G; Polish types its
 * ogonek letters with it. Windows delivers AltGr as Ctrl+Alt — both `ctrlKey`
 * and `altKey` are true on the keydown — so a handler that reads "Ctrl or Meta"
 * as the shortcut modifier sees every one of those characters as a chord.
 * That is how `[` and `]` became untypable in both panes (outdent / indent ate
 * them), and how Hungarian AltGr+F opened Find & Replace instead of typing `[`:
 * markdown links, task lists and `[[wiki links]]` could not be written at all.
 *
 * True when this keydown is AltGr producing text rather than a shortcut:
 *  - the browser says so (`getModifierState("AltGraph")`), or
 *  - off the Mac, Ctrl+Alt without Meta produced something other than the
 *    key's own Latin letter.
 *
 * The second rule is what keeps the one documented Ctrl+Alt chord (⌥⌘F, shown
 * as Ctrl+Alt+F on Windows) working on a layout with nothing on AltGr+F: there
 * the browser reports the key's own letter (`key: "f"`, `code: "KeyF"`), while
 * a layout's AltGr level yields a symbol or a non-ASCII letter (`"["` from
 * Hungarian AltGr+F, `"ł"` from Polish AltGr+L). A symbol on a non-letter key
 * (Swiss AltGr+ü → `"["`, `code: "BracketLeft"`) is treated as text too:
 * matching `key` against a US reading of `code` would have handed those back to
 * the outdent chord.
 *
 * Meta never takes part in AltGr, and on a Mac ⌥ composes text on its own, so
 * ⌥⌘F there is always a real chord.
 */
export function isAltGraphInput(e: KeyboardEvent, mac: boolean = IS_MAC): boolean {
  if (e.metaKey) return false;
  if (typeof e.getModifierState === "function" && e.getModifierState("AltGraph")) return true;
  if (mac) return false;
  if (!(e.ctrlKey && e.altKey)) return false;
  const k = e.key ?? "";
  const ownLetter = k.length === 1 && /^[a-z]$/i.test(k) && e.code === `Key${k.toUpperCase()}`;
  return !ownLetter;
}

/** CodeMirror spells a binding "Mod-Alt-\\"; split the way it does (a trailing
 *  "-" is the minus key, not a separator). */
function parseKey(key: string): { mods: Set<string>; name: string } {
  const parts = key.split(/-(?!$)/);
  const name = parts.pop() ?? "";
  return { mods: new Set(parts.map((p) => p.toLowerCase())), name };
}

/**
 * Drop the keymap bindings that AltGr typing would trigger.
 *
 * Off the Mac, `Mod` is Ctrl, so a binding on Ctrl+Alt+<character> is exactly
 * the chord AltGr+<that key> produces. CodeMirror's default keymap binds
 * `Mod-Alt-\` to indentSelection — and `\` is an AltGr character on German,
 * French, Spanish, Czech, Hungarian, Swiss and Nordic layouts, so the
 * backslash (markdown's escape character) could not be typed into the markdown
 * pane at all: the keymap consumed it and re-indented the line instead.
 * CodeMirror guards only its FALLBACK lookup against AltGr, not a direct match.
 *
 * Letters stay bound (an AltGr layer never produces the key's own letter), and
 * so do named keys (arrows and friends are not text).
 */
export function dropAltGraphChords<T extends { key?: string }>(
  bindings: readonly T[],
  mac: boolean = IS_MAC
): T[] {
  if (mac) return [...bindings];
  return bindings.filter((b) => {
    if (!b.key) return true;
    const { mods, name } = parseKey(b.key);
    const ctrl = mods.has("mod") || mods.has("ctrl") || mods.has("control") || mods.has("c");
    const alt = mods.has("alt") || mods.has("a");
    const meta = mods.has("meta") || mods.has("cmd") || mods.has("m");
    if (!ctrl || !alt || meta) return true;
    const isChar = [...name].length === 1 && name !== " ";
    return !isChar || /^[a-z]$/i.test(name);
  });
}
