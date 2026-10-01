/**
 * Portable hard breaks (A051): the switch an EXPORT converts under.
 *
 * The app reads markdown with `breaks: true` — a single newline inside a
 * paragraph IS a line break — so the editor writes a hard break (`<br>`) as a
 * bare newline (turndown's two trailing spaces are removed by
 * normalizeMarkdown). A file that leaves the app is read by renderers without
 * that dialect, which join the two lines into one. An export therefore writes
 * a hard break as `\` + newline: CommonMark's own hard break, which the app
 * reads back as the same single break, and which no editor strips the way it
 * strips trailing spaces.
 *
 * Only exports: the markdown pane's projection is exactly what it was. While
 * `withPortableBreaks` runs, the turndown rules (turndown-rules.ts) write each
 * <br> with a marker in front, the paragraph rule turns a marked break into
 * `\` wherever the app would draw it, and the converter drops the markers of
 * the rest (stripBreakMarks) before its whitespace pass — so everything except
 * those breaks is byte-for-byte what the editor writes.
 *
 * A separate module, with no dependencies, so the export helpers in `store/`
 * can switch it without importing the converters.
 */

/**
 * Marks a hard break during an export's conversion; never survives it.
 *
 * A SPACE character (MEDIUM MATHEMATICAL SPACE, rare in prose) and not a
 * line terminator, so every `trim()` and `\s` in the rules treats `mark + "  \n"`
 * exactly as it treats the editor's `"  \n"` \u2014 a bold run holding nothing but a
 * break is still empty, and dropped \u2014 while `^`/`$` in the rules' multiline
 * regexes still see the one newline that follows it.
 */
export const BREAK_MARK = "\u205F";

let active = false;

function run<T>(on: boolean, convert: () => T): T {
  const was = active;
  active = on;
  try {
    return convert();
  } finally {
    active = was;
  }
}

/**
 * Convert with portable hard breaks — for markdown that leaves the app. Any
 * of the engine's HTML → markdown converters honours it (`htmlToMd`,
 * `htmlToCleanMd`); the rich pane's per-block projection deliberately does not.
 */
export const withPortableBreaks = <T>(convert: () => T): T => run(true, convert);

/**
 * Convert with portable breaks OFF, even inside an export: for the markdown
 * pane's projection, and for markup that already holds the marker character
 * (a private-use icon font can put one in a document), which is then exported
 * with the app's own breaks rather than have its character taken for a marker.
 */
export const withoutPortableBreaks = <T>(convert: () => T): T => run(false, convert);

/** Whether an export conversion is running. */
export const portableBreaksActive = (): boolean => active;

/** True if `html` holds the marker character, so it cannot be marked safely. */
export const holdsBreakMark = (html: string): boolean => html.indexOf(BREAK_MARK) !== -1;

/** Drop the markers of breaks that did not become `\` + newline. */
export function stripBreakMarks(md: string): string {
  return md.indexOf(BREAK_MARK) === -1 ? md : md.split(BREAK_MARK).join("");
}
