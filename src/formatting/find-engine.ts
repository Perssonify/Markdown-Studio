/**
 * Find & Replace — the matching engine. Pure: no React, no editor.
 *
 * ONE place turns the Find panel's query and options into matches, and every
 * consumer uses its output: the count, Next/Previous, Find all, Replace,
 * Replace All, Format matches, the scrollbar ticks and BOTH panes'
 * highlighters. They used to rebuild the pattern separately — the
 * highlighters from the raw term with a hard-coded "gi", so a case-sensitive
 * or whole-word search highlighted matches it did not count, and their
 * `toLowerCase().indexOf` misaligned every highlight after an "İ" (which
 * lower-cases to TWO code units) — and the user's regex ran three or four
 * times per keystroke.
 */

import { fencedBlocks, fencedLineMask } from "./select-scope";

export interface FindOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export type FindPane = "md" | "rich";

/** A compiled query. `wordFilter` is set when whole-word could not be written
 *  into the pattern itself (see compileFindQuery) and must be checked per match. */
export interface CompiledQuery {
  source: string;
  flags: string;
  wordFilter: boolean;
}

/** One match, relative to the string it was found in. `indices` are the
 *  capture groups' [start, end] (null when a group did not take part). */
export interface FindMatch {
  index: number;
  length: number;
  groups: (string | null)[];
  named: Record<string, string | null> | null;
  indices: ([number, number] | null)[] | null;
}

export interface ExecResult {
  matches: FindMatch[];
  /** Stopped early: the match cap or the time budget was reached. */
  truncated: boolean;
}

/** More matches than this are not collected (the count reads "10000+"). */
export const MAX_FIND_MATCHES = 10000;

/**
 * What a pane's search highlighter draws, in that pane's positions. Computed
 * ONCE by the Find panel from the same matches it counts — the highlighters
 * never run the pattern themselves any more.
 */
export interface HighlightRange {
  from: number;
  to: number;
  /** Capture-group sub-ranges to colour (regex mode). */
  groups?: [number, number][];
  /** Replace mode: the text this match would become, drawn after it; null
   *  when it would not change (or past the preview cap). */
  preview?: string | null;
}
export interface HighlightSpec {
  ranges: HighlightRange[];
  /** Draw matches struck-through with their replacement previews. */
  replaceMode: boolean;
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
const escapeForRegExp = (s: string) => s.replace(ESCAPE_RE, "\\$&");

let hasIndicesFlag = false;
try { hasIndicesFlag = new RegExp("", "d").hasIndices === true; } catch { /* old engine */ }

/** Letters, digits, combining marks and "_" — a word character in any script. */
const WORD_CLASS = "[\\p{L}\\p{N}\\p{M}_]";

/**
 * Compile the Find query.
 *
 *  - Literal text is escaped; a regex is used as written.
 *  - Case-insensitive unless "Match case".
 *  - In the MARKDOWN pane `^` and `$` are line anchors (the `m` flag) — without
 *    it they meant the start and end of the whole document, so `^#` matched
 *    nothing but a heading on line 1.
 *  - WHOLE WORD is Unicode-aware. It was `\b(?:…)\b`, and `\b` only knows
 *    ASCII letters: "мир", "東京" and "Café" never matched as whole words. It is
 *    written as lookarounds on a Unicode word class, which needs the `u` flag;
 *    a user regex that is not valid under `u` (e.g. an escaped quote, `\"`)
 *    keeps its old meaning and gets the whole-word check per match instead.
 *
 * Throws a SyntaxError for an invalid regex (the panel shows its message).
 */
export function compileFindQuery(query: string, opts: FindOptions, pane: FindPane): CompiledQuery {
  const base = opts.regex ? query : escapeForRegExp(query);
  const flags = (opts.caseSensitive ? "" : "i") + (pane === "md" ? "m" : "") + (opts.regex && hasIndicesFlag ? "d" : "");
  const unicodeSource = opts.wholeWord ? `(?<!${WORD_CLASS})(?:${base})(?!${WORD_CLASS})` : base;
  try {
    new RegExp(unicodeSource, flags + "u");
    return { source: unicodeSource, flags: flags + "u", wordFilter: false };
  } catch (err) {
    if (!opts.regex) throw err; // an escaped literal is always valid under `u`
  }
  new RegExp(base, flags); // throws the user's own syntax error
  return { source: base, flags, wordFilter: opts.wholeWord };
}

/**
 * Run a compiled query over `text`, collecting at most `maxMatches` matches
 * and stopping once `deadline` (a `Date.now()` value; 0 = none) has passed.
 *
 * SELF-CONTAINED on purpose — no imports, no module constants, conservative
 * syntax — because find-worker.ts ships its source text to a Web Worker, so the
 * worker and the main-thread fallback run the exact same code.
 *
 * A zero-length match advances by one code point, so `^`, `\b` or a lookahead
 * can never stall the loop, and is still reported (a Replace All of `^` with
 * "> " quotes every line).
 */
/* eslint-disable no-var -- this function's SOURCE TEXT runs in a Web Worker (find-worker.ts): conservative syntax on purpose */
export function execAllCore(
  source: string,
  flags: string,
  text: string,
  maxMatches: number,
  deadline: number,
  wordFilter: boolean
): ExecResult {
  var re = new RegExp(source, flags.indexOf("g") >= 0 ? flags : flags + "g");
  var unicode = flags.indexOf("u") >= 0;
  var wordChar = wordFilter ? new RegExp("[\\p{L}\\p{N}\\p{M}_]", "u") : null;
  var matches: FindMatch[] = [];
  var truncated = false;
  var steps = 0;
  var m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    var start = m.index;
    var len = m[0].length;
    if (len === 0) {
      var cp = text.codePointAt(start);
      re.lastIndex = start + (unicode && cp !== undefined && cp > 0xffff ? 2 : 1);
    }
    var keep = true;
    if (wordChar) {
      // The whole code points either side of the match (a low surrogate
      // before `start` belongs to the pair that begins one unit earlier).
      var before = "";
      if (start > 0) {
        var bi = start - 1;
        var unit = text.charCodeAt(bi);
        if (unit >= 0xdc00 && unit <= 0xdfff && bi > 0) bi--;
        before = String.fromCodePoint(text.codePointAt(bi) as number);
      }
      var after = start + len < text.length ? String.fromCodePoint(text.codePointAt(start + len) as number) : "";
      keep = !(before && wordChar.test(before)) && !(after && wordChar.test(after));
    }
    if (keep) {
      var groups: (string | null)[] = [];
      for (var g = 1; g < m.length; g++) groups.push(m[g] === undefined ? null : (m[g] as string));
      var named: Record<string, string | null> | null = null;
      if (m.groups) {
        named = {};
        for (var k in m.groups) named[k] = m.groups[k] === undefined ? null : (m.groups[k] as string);
      }
      var indices: ([number, number] | null)[] | null = null;
      var rawIdx = (m as unknown as { indices?: ([number, number] | undefined)[] }).indices;
      if (rawIdx) {
        indices = [];
        for (var gi = 1; gi < rawIdx.length; gi++) indices.push(rawIdx[gi] ? [rawIdx[gi]![0], rawIdx[gi]![1]] : null);
      }
      matches.push({ index: start, length: len, groups: groups, named: named, indices: indices });
      if (matches.length >= maxMatches) { truncated = true; break; }
    }
    if (deadline && ++steps % 64 === 0 && Date.now() > deadline) { truncated = true; break; }
  }
  return { matches: matches, truncated: truncated };
}
/* eslint-enable no-var */

/**
 * The text a `$`-template produces for one match — String.prototype.replace's
 * GetSubstitution, computed from the ORIGINAL match rather than by re-running
 * the pattern on the matched text alone.
 *
 * The re-run is what made context-dependent patterns silently do nothing:
 * `\d+(?=px)` matches "12" in "12px", but applied to the isolated "12" the
 * lookahead has no "px" to see, so the match was counted, highlighted — and
 * never replaced, in either pane, single or all (A060).
 *
 * `input` is the string the match was found in (for `` $` `` and `$'`).
 */
export function expandReplacement(template: string, m: FindMatch, input: string): string {
  const matched = input.slice(m.index, m.index + m.length);
  const n = m.groups.length;
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const ch = template[i]!;
    if (ch !== "$" || i === template.length - 1) { out += ch; continue; }
    const next = template[i + 1]!;
    if (next === "$") { out += "$"; i++; continue; }
    if (next === "&") { out += matched; i++; continue; }
    if (next === "`") { out += input.slice(0, m.index); i++; continue; }
    if (next === "'") { out += input.slice(m.index + m.length); i++; continue; }
    if (next === "<" && m.named) {
      const close = template.indexOf(">", i + 2);
      if (close !== -1) {
        const name = template.slice(i + 2, close);
        out += m.named[name] ?? "";
        i = close;
        continue;
      }
      out += "$";
      continue;
    }
    if (next >= "0" && next <= "9") {
      const two = template[i + 2];
      const d1 = next.charCodeAt(0) - 48;
      if (two !== undefined && two >= "0" && two <= "9") {
        const d2 = d1 * 10 + (two.charCodeAt(0) - 48);
        if (d2 >= 1 && d2 <= n) { out += m.groups[d2 - 1] ?? ""; i += 2; continue; }
      }
      if (d1 >= 1 && d1 <= n) { out += m.groups[d1 - 1] ?? ""; i++; continue; }
    }
    out += "$";
  }
  return out;
}

/**
 * The next (dir 1) or previous (dir -1) match relative to the selection
 * [selFrom, selTo], wrapping around. Ranges are sorted and non-overlapping.
 *
 * "Next" used to mean the first match starting at or after the selection's
 * END — for a ZERO-LENGTH match (`^`, `\b`, a lookahead) that is the match
 * already selected, so Next never moved.
 */
export function pickMatch(
  ranges: readonly { from: number; to: number }[],
  selFrom: number,
  selTo: number,
  dir: 1 | -1
): number {
  if (!ranges.length) return -1;
  if (dir > 0) {
    const i = ranges.findIndex((r) => r.from > selFrom || (r.from === selFrom && r.to > selTo));
    return i === -1 ? 0 : i;
  }
  for (let i = ranges.length - 1; i >= 0; i--) {
    const r = ranges[i]!;
    if (r.to < selTo || (r.to === selTo && r.from < selFrom)) return i;
  }
  return ranges.length - 1;
}

/**
 * The match find-as-you-type selects: the first one starting at or after the
 * selection's START. It used to anchor on the caret (`head`) — the END of the
 * previous match — so typing "a" selected an "a" and typing "ab" then skipped
 * the "ab" at that very spot and jumped to the next one.
 */
export function firstMatchFrom(ranges: readonly { from: number }[], selFrom: number): number {
  if (!ranges.length) return -1;
  const i = ranges.findIndex((r) => r.from >= selFrom);
  return i === -1 ? 0 : i;
}

/**
 * Could this regex take exponential time? A nested quantifier — a repeated
 * group that itself contains a repeat, `(a+)+`, `(\w*)*`, `(x{2,})+` — is the
 * classic catastrophic-backtracking shape (`(a+)+$` over 28 characters took
 * 5.2s in the audit). Only consulted where a pattern cannot be run in a
 * terminable Worker; it is a heuristic, not a proof.
 */
export function hasNestedQuantifier(source: string): boolean {
  // Per open group: does it contain a repeat? Stack of flags.
  const stack: boolean[] = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; continue; }
    if (c === "(") { stack.push(false); continue; }
    const repeatAt = (j: number): number => {
      // Length of an unbounded/multi repeat at j (*, +, {n,}, {n,m>1}), else 0.
      const q = source[j];
      if (q === "*" || q === "+") return 1;
      if (q === "{") {
        const mm = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(j));
        if (mm && (mm[2] !== undefined && (mm[3] === "" || Number(mm[3]) > 1))) return mm[0].length;
      }
      return 0;
    };
    if (c === ")") {
      const inner = stack.pop() ?? false;
      const rep = repeatAt(i + 1);
      if (rep && inner) return true;
      if (stack.length && (inner || rep)) stack[stack.length - 1] = true;
      continue;
    }
    if (repeatAt(i) && stack.length) stack[stack.length - 1] = true;
  }
  return false;
}

// ── Markdown regions (the Find panel's scope filter) ─────────────────────────

/** Character ranges of the CONTENT of every ATX heading line (after "# "),
 *  skipping fenced code — a `# comment` in a ```bash block is not a heading
 *  (A062). Shares the fence tracker with the Select scopes and case tools. */
export function mdHeadingRanges(doc: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const lines = doc.split("\n");
  const fenced = fencedLineMask(lines);
  let idx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!fenced[i]) {
      const m = line.match(/^(#{1,6}\s+)(.*)$/);
      if (m && m[2]!.length) ranges.push([idx + m[1]!.length, idx + line.length]);
    }
    idx += line.length + 1;
  }
  return ranges;
}

/** Fenced blocks (by the shared tracker) plus inline code spans. */
export function mdCodeRanges(doc: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const lines = doc.split("\n");
  const starts: number[] = [];
  let off = 0;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  for (const b of fencedBlocks(lines)) out.push([starts[b.start]!, starts[b.end]! + lines[b.end]!.length]);
  const inline = /`[^`\n]+`/g;
  let m: RegExpExecArray | null;
  while ((m = inline.exec(doc))) {
    const s = m.index;
    if (!out.some(([a, b]) => s >= a && s < b)) out.push([s, s + m[0].length]);
  }
  return out;
}
