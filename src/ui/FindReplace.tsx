import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
    Collapsible,
    CollapsibleContent,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Ban, Bold, CaseSensitive, Check, ChevronDown, ChevronUp, Funnel, GripHorizontal, Highlighter, Info, Italic, Regex, Replace, ReplaceAll, Search, Underline as UnderlineIcon, WholeWord, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorSelection } from "@codemirror/state";
import { MODES } from "../constants";
import { applyCase, type CaseMode } from "../formatting/case-transform";
import { useUIStore } from "../store/uiStore";
export interface MatchPosition {
  pos: number;
  len: number;
}

/** Character ranges of the CONTENT of every ATX heading line (after "# "). */
function mdHeadingRanges(doc: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let idx = 0;
  for (const line of doc.split("\n")) {
    const m = line.match(/^(#{1,6}\s+)(.*)$/);
    if (m && m[2]!.length) ranges.push([idx + m[1]!.length, idx + line.length]);
    idx += line.length + 1;
  }
  return ranges;
}
const inRanges = (pos: number, len: number, ranges: Array<[number, number]>) =>
  ranges.some(([s, e]) => pos >= s && pos + len <= e);

// Find/Replace option toggles persist across sessions (like uiStore.caseContentOnly).
const readFrBool = (key: string, def = false): boolean => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v === "true";
  } catch {
    return def;
  }
};
const writeFrBool = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* storage unavailable — still applies for this session */
  }
};
const FR_REGEX_KEY = "pf:fr-regex";
const FR_HEADINGS_KEY = "pf:fr-headings";
const FR_CASE_KEY = "pf:fr-case";
const FR_WORD_KEY = "pf:fr-word";
const FR_SCOPE_KEY = "pf:fr-scope";
const FR_POS_KEY = "pf:fr-pos";

// MD scope filter: include-only / exclude / off, per region. Lets you search only
// (or never) inside headings, code, links, or emphasis in the Markdown pane.
export type ScopeState = "off" | "include" | "exclude";
export type ScopeRegion = "headings" | "code" | "links" | "bold" | "italic" | "strike" | "highlight";
// Structure regions + format regions, both usable as include/exclude filters.
export const SCOPE_REGIONS: { id: ScopeRegion; label: string; group: "Structure" | "Formatting" }[] = [
  { id: "headings", label: "Headings", group: "Structure" },
  { id: "code", label: "Code", group: "Structure" },
  { id: "links", label: "Links / URLs", group: "Structure" },
  { id: "bold", label: "Bold", group: "Formatting" },
  { id: "italic", label: "Italic", group: "Formatting" },
  { id: "strike", label: "Strikethrough", group: "Formatting" },
  { id: "highlight", label: "Highlight", group: "Formatting" },
];
const defaultScope = (): Record<ScopeRegion, ScopeState> => ({ headings: "off", code: "off", links: "off", bold: "off", italic: "off", strike: "off", highlight: "off" });
const readScope = (): Record<ScopeRegion, ScopeState> => {
  const s = defaultScope();
  try {
    const raw = localStorage.getItem(FR_SCOPE_KEY);
    if (raw) Object.assign(s, JSON.parse(raw));
    else if (localStorage.getItem(FR_HEADINGS_KEY) === "true") s.headings = "include"; // migrate old toggle
  } catch { /* ignore */ }
  return s;
};

// Region range finders in raw Markdown text (approximate but robust).
const mdCodeRanges = (doc: string): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  const fence = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm;
  while ((m = fence.exec(doc))) out.push([m.index, m.index + m[0].length]);
  const inline = /`[^`\n]+`/g;
  while ((m = inline.exec(doc))) { const s = m.index; if (!out.some(([a, b]) => s >= a && s < b)) out.push([s, s + m[0].length]); }
  return out;
};
const mdLinkRanges = (doc: string): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  const link = /\]\(([^)\s]+)[^)]*\)/g;
  while ((m = link.exec(doc))) out.push([m.index + 2, m.index + m[0].length - 1]);
  const auto = /<https?:\/\/[^>]+>/g;
  while ((m = auto.exec(doc))) out.push([m.index, m.index + m[0].length]);
  const bare = /\bhttps?:\/\/[^\s)]+/g;
  while ((m = bare.exec(doc))) out.push([m.index, m.index + m[0].length]);
  return out;
};
const collect = (doc: string, re: RegExp): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc))) out.push([m.index, m.index + m[0].length]);
  return out;
};
const mdBoldRanges = (doc: string) => collect(doc, /\*\*[^\n]+?\*\*|__[^\n]+?__/g);
const mdItalicRanges = (doc: string) => collect(doc, /(?<!\*)\*(?!\*)[^\n*]+?\*(?!\*)|(?<!_)_(?!_)[^\n_]+?_(?!_)/g);
const mdStrikeRanges = (doc: string) => collect(doc, /~~[^\n]+?~~/g);
// Bounded attribute windows ({0,300}) keep the span alternative linear — an
// unbounded `[^>]*background[^>]*` backtracks polynomially on long non-`>` runs.
const mdHighlightRanges = (doc: string) => collect(doc, /==[^\n]+?==|<span[^>]{0,300}background[^>]{0,300}>[\s\S]*?<\/span>/gi);
const overlaps = (pos: number, len: number, ranges: Array<[number, number]>) =>
  ranges.some(([s, e]) => !(pos + len <= s || pos >= e));

export interface FindReplaceBarProps {
  sourceRef: RefObject<any>;
  previewRef: RefObject<any>;
  mode: string;
  onSync?: () => void;
  syncHtmlToMd?: () => void;
  onClose: () => void;
  /** Seed the find field on open (e.g. from the global search panel). */
  initialQuery?: string;
  /** Open with the replace row already expanded (⌘H / Edit ▸ Replace). */
  initialShowReplace?: boolean;
  /** Which panel mode to open in — ⌘F → find, ⌘H → replace. Passed live so a
   *  ⌘H while the panel is already open switches it to replace. */
  initialMode?: "find" | "replace";
  /** Default search pane, derived from where the cursor was (last-focused pane). */
  initialTarget?: "md" | "richtext";
}

export function FindReplaceBar({
  sourceRef,
  previewRef,
  mode,
  onSync,
  syncHtmlToMd,
  onClose,
  initialQuery,
  initialShowReplace,
  initialMode,
  initialTarget,
}: FindReplaceBarProps) {
  // Read-only mode: Find/Next/Prev stay available (read-only navigation), but
  // Replace / Replace All / Format matches mutate the document, so they're hidden.
  const readOnly = useUIStore((s) => s.readOnly);
  const [findText, setFindText] = useState(initialQuery ?? "");
  const [replaceText, setReplaceText] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  // Number of headings in the active pane — only tracked for the "select all
  // headings" mode (headings-only toggle on, no query) so the format row can
  // enable + label itself.
  const [headingCount, setHeadingCount] = useState(0);
  // Panel mode: Find or Replace (a segmented control, not a toggle button).
  // Read-only forces Find (Replace mutates). showReplace kept as a derived alias
  // so the existing highlight/logic keeps working unchanged.
  const [panelMode, setPanelMode] = useState<"find" | "replace">(
    initialMode ?? (initialShowReplace ? "replace" : "find"),
  );
  const showReplace = panelMode === "replace" && !readOnly;
  const setShowReplace = useCallback((open: boolean) => setPanelMode(open ? "replace" : "find"), []);
  // Search options are persisted and mirrored into refs so the search / replace /
  // format callbacks can read them without churning their dependency arrays.
  const [useRegex, setUseRegex] = useState(() => readFrBool(FR_REGEX_KEY));
  const [caseSensitive, setCaseSensitive] = useState(() => readFrBool(FR_CASE_KEY));
  const [wholeWord, setWholeWord] = useState(() => readFrBool(FR_WORD_KEY));
  // MD scope include/exclude filter (per region); persisted. The headings=include
  // case doubles as the old "headings only" toggle (used by both panes + format).
  const [mdScope, setMdScope] = useState<Record<ScopeRegion, ScopeState>>(() => readScope());
  const [showScope, setShowScope] = useState(false);
  const headingsOnly = mdScope.headings === "include";
  const mdScopeRef = useRef(mdScope);
  mdScopeRef.current = mdScope;
  const useRegexRef = useRef(useRegex);
  useRegexRef.current = useRegex;
  const headingsOnlyRef = useRef(headingsOnly);
  headingsOnlyRef.current = headingsOnly;
  const cycleScope = useCallback((region: ScopeRegion) => {
    setMdScope((prev) => {
      const order: ScopeState[] = ["off", "include", "exclude"];
      const next = { ...prev, [region]: order[(order.indexOf(prev[region]) + 1) % 3]! };
      try { localStorage.setItem(FR_SCOPE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const caseSensitiveRef = useRef(caseSensitive);
  caseSensitiveRef.current = caseSensitive;
  const wholeWordRef = useRef(wholeWord);
  wholeWordRef.current = wholeWord;
  const [regexError, setRegexError] = useState<string | null>(null);

  const toggleRegex = useCallback(() => setUseRegex((v) => { writeFrBool(FR_REGEX_KEY, !v); return !v; }), []);
  const toggleCaseSensitive = useCallback(() => setCaseSensitive((v) => { writeFrBool(FR_CASE_KEY, !v); return !v; }), []);
  const toggleWholeWord = useCallback(() => setWholeWord((v) => { writeFrBool(FR_WORD_KEY, !v); return !v; }), []);

  // Build a search regex honoring the regex / case-sensitive / whole-word options.
  // Reads refs so it stays identity-stable; returns null on an invalid pattern.
  const buildSource = useCallback((text: string): string => {
    let src = useRegexRef.current ? text : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWordRef.current) src = `\\b(?:${src})\\b`;
    return src;
  }, []);
  const buildRegex = useCallback((text: string, global = true): RegExp | null => {
    try {
      return new RegExp(buildSource(text), (global ? "g" : "") + (caseSensitiveRef.current ? "" : "i"));
    } catch {
      return null;
    }
  }, [buildSource]);
  const [searchTarget, setSearchTarget] = useState<"md" | "richtext">(
    // Prefer the pane the cursor was in; fall back to the visible view mode.
    initialTarget ?? (mode === MODES.HTML ? "richtext" : "md")
  );
  const findInputRef = useRef<HTMLInputElement>(null);

  // Floating-panel drag: `pos` is null until first dragged (anchored top-right
  // by class), then pixel coords clamped to the viewport.
  const panelRef = useRef<HTMLDivElement>(null);
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const startDrag = useCallback((e: React.PointerEvent) => {
    const el = panelRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragOffset.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    setPos({ x: rect.left, y: rect.top }); // pin current spot so it doesn't jump
    setDragging(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }, []);

  const onDrag = useCallback((e: React.PointerEvent) => {
    const off = dragOffset.current;
    const el = panelRef.current;
    if (!off || !el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, e.clientX - off.dx));
    const y = Math.max(4, Math.min(window.innerHeight - h - 4, e.clientY - off.dy));
    setPos({ x, y });
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    dragOffset.current = null;
    setDragging(false);
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    // Remember where it was dragged to, so it reopens there next time.
    const rect = panelRef.current?.getBoundingClientRect();
    if (rect) { try { localStorage.setItem(FR_POS_KEY, JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) })); } catch { /* ignore */ } }
  }, []);

  // Initial placement (before paint, no flash): restore the last dragged position,
  // else center the panel on the viewport. Clamped so it's always on-screen.
  useLayoutEffect(() => {
    const el = panelRef.current;
    const w = el?.offsetWidth ?? 520;
    const h = el?.offsetHeight ?? 220;
    const clamp = (x: number, y: number) => ({
      x: Math.max(4, Math.min(window.innerWidth - w - 4, x)),
      y: Math.max(4, Math.min(window.innerHeight - h - 4, y)),
    });
    let restored: { x: number; y: number } | null = null;
    try { const raw = localStorage.getItem(FR_POS_KEY); if (raw) restored = JSON.parse(raw); } catch { /* ignore */ }
    if (restored && typeof restored.x === "number" && typeof restored.y === "number") {
      setPos(clamp(restored.x, restored.y));
    } else {
      setPos(clamp((window.innerWidth - w) / 2, Math.max(16, (window.innerHeight - h) / 2 - 40)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-clamp on window resize so a shrinking viewport can't strand the fixed
  // panel off-screen (with no way to drag it back). Mirrors the drag clamp.
  useEffect(() => {
    const onResize = () => {
      const el = panelRef.current;
      const w = el?.offsetWidth ?? 520;
      const h = el?.offsetHeight ?? 220;
      setPos((p) =>
        p
          ? {
              x: Math.max(4, Math.min(window.innerWidth - w - 4, p.x)),
              y: Math.max(4, Math.min(window.innerHeight - h - 4, p.y)),
            }
          : p
      );
    };
    window.addEventListener("resize", onResize);
    // ...and whenever the PANEL itself changes size. Expanding the scope filter
    // or switching Find→Replace grows it by 110-175px; without this the buttons
    // ended up off-screen (and max-h-[90dvh] never engaged, so it couldn't even
    // be scrolled).
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined" && panelRef.current) {
      ro = new ResizeObserver(() => onResize());
      ro.observe(panelRef.current);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, []);

  const mdAvailable = mode === MODES.MD || mode === MODES.SPLIT;
  const textAvailable = mode === MODES.HTML || mode === MODES.SPLIT;
  const isMd = searchTarget === "md";

  useEffect(() => {
    if (isMd && !mdAvailable) setSearchTarget("richtext");
    if (!isMd && !textAvailable) setSearchTarget("md");
  }, [mode, isMd, mdAvailable, textAvailable]);

  useEffect(() => {
    setMatchCount(0);
    setCurrentMatch(0);
  }, [searchTarget]);

  const getMatchPositions = useCallback((doc: string, searchText: string): MatchPosition[] => {
    if (!searchText) return [];
    let re: RegExp;
    try {
      re = new RegExp(buildSource(searchText), caseSensitiveRef.current ? "g" : "gi");
      setRegexError(null);
    } catch (e: any) {
      setRegexError(e.message);
      return [];
    }
    const positions: MatchPosition[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(doc)) !== null) {
      positions.push({ pos: m.index, len: m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
    return positions;
  }, [buildSource]);

  /** Apply the markdown-pane scope filter (per-region include / exclude). */
  const scopeMd = useCallback((matches: MatchPosition[], doc: string): MatchPosition[] => {
    const sc = mdScopeRef.current;
    if (Object.values(sc).every((v) => v === "off")) return matches;
    const rangesFor = (r: ScopeRegion): Array<[number, number]> =>
      r === "headings" ? mdHeadingRanges(doc)
      : r === "code" ? mdCodeRanges(doc)
      : r === "links" ? mdLinkRanges(doc)
      : r === "bold" ? mdBoldRanges(doc)
      : r === "italic" ? mdItalicRanges(doc)
      : r === "strike" ? mdStrikeRanges(doc)
      : mdHighlightRanges(doc);
    const includes: Array<[number, number]> = [];
    const excludes: Array<[number, number]> = [];
    (Object.keys(sc) as ScopeRegion[]).forEach((r) => {
      if (sc[r] === "include") includes.push(...rangesFor(r));
      else if (sc[r] === "exclude") excludes.push(...rangesFor(r));
    });
    const anyInclude = Object.values(sc).some((v) => v === "include");
    return matches.filter((m) => {
      if (anyInclude && !inRanges(m.pos, m.len, includes)) return false; // must sit inside an included region
      if (overlaps(m.pos, m.len, excludes)) return false; // …and outside every excluded one
      return true;
    });
  }, []);

  // --- CM6 search helpers ---

  const findInCM6 = useCallback((searchText: string) => {
    if (!searchText) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const cm = sourceRef.current;
    if (!cm) return;
    const view = cm.getView();
    if (!view) return;

    const doc = view.state.doc.toString();
    const matches = scopeMd(getMatchPositions(doc, searchText), doc);
    setMatchCount(matches.length);

    if (matches.length === 0) {
      setCurrentMatch(0);
      return;
    }

    const cursor = view.state.selection.main.head;
    let nearest = 0;

    for (let i = 0; i < matches.length; i++) {
      if (matches[i]!.pos >= cursor) {
        nearest = i;
        break;
      }
      nearest = i;
    }

    setCurrentMatch(nearest + 1);
    const m = matches[nearest];

    view.dispatch({
      selection: { anchor: m!.pos, head: m!.pos + m!.len },
      scrollIntoView: true,
    });
  }, [sourceRef, getMatchPositions, scopeMd]);

  const findNextInCM6 = useCallback((searchText: string, direction = 1) => {
    const cm = sourceRef.current;
    if (!cm || !searchText) return;
    const view = cm.getView();
    if (!view) return;

    const doc = view.state.doc.toString();
    const matches = scopeMd(getMatchPositions(doc, searchText), doc);
    if (matches.length === 0) return;

    const cursorEnd = view.state.selection.main.to;
    const cursorStart = view.state.selection.main.from;

    let idx;
    if (direction > 0) {
      idx = matches.findIndex((m: MatchPosition) => m.pos >= cursorEnd);
      if (idx === -1) idx = 0;
    } else {
      idx = -1;
      for (let i = matches.length - 1; i >= 0; i--) {
        if (matches[i]!.pos < cursorStart) {
          idx = i;
          break;
        }
      }
      if (idx === -1) idx = matches.length - 1;
    }

    const m = matches[idx];
    view.dispatch({
      selection: { anchor: m!.pos, head: m!.pos + m!.len },
      scrollIntoView: true,
    });
    setCurrentMatch(idx + 1);
  }, [sourceRef, getMatchPositions, scopeMd]);

  const replaceInCM6 = useCallback((searchText: string, replacement: string) => {
    const cm = sourceRef.current;
    if (!cm || !searchText) return;
    const view = cm.getView();
    if (!view) return;

    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);

    if (useRegex) {
      try {
        // Route through buildRegex so whole-word wrapping matches Find/Next/highlight.
        const re = buildRegex(searchText, false);
        const match = re ? re.exec(selected) : null;
        if (re && match && match[0] === selected) {
          const expanded = selected.replace(re, replacement);
          view.dispatch({
            changes: { from, to, insert: expanded },
            selection: { anchor: from + expanded.length },
          });
          if (onSync) onSync();
          findNextInCM6(searchText);
        } else {
          findNextInCM6(searchText);
        }
      } catch {
        findNextInCM6(searchText);
      }
    } else {
      const eq = caseSensitiveRef.current
        ? selected === searchText
        : selected.toLowerCase() === searchText.toLowerCase();
      if (eq) {
        view.dispatch({
          changes: { from, to, insert: replacement },
          selection: { anchor: from + replacement.length },
        });
        if (onSync) onSync();
        findNextInCM6(searchText);
      } else {
        findNextInCM6(searchText);
      }
    }
  }, [sourceRef, onSync, findNextInCM6, useRegex, buildRegex]);

  const replaceAllInCM6 = useCallback((searchText: string, replacement: string) => {
    const cm = sourceRef.current;
    if (!cm || !searchText) return;
    const view = cm.getView();
    if (!view) return;

    const doc = view.state.doc.toString();

    // Scoped replace: whenever ANY MD scope filter is active (headings, code,
    // links, bold/italic/strike/highlight — include OR exclude), replace only the
    // matches that survive the same `scopeMd` filter the count/markers use, so
    // Replace All mutates exactly the matches shown. A plain full-document
    // `doc.replace` would ignore the filter and rewrite excluded regions too.
    const scopeActive = Object.values(mdScopeRef.current).some((v) => v !== "off");
    if (scopeActive) {
      const matches = scopeMd(getMatchPositions(doc, searchText), doc);
      if (!matches.length) { setMatchCount(0); setCurrentMatch(0); return; }
      const singleRe = useRegexRef.current ? buildRegex(searchText, false) : null;
      const changes = matches.map((mm) => {
        const seg = doc.slice(mm.pos, mm.pos + mm.len);
        // Literal mode: CodeMirror inserts `insert` verbatim (no $-substitution),
        // so the raw replacement is correct. Regex mode routes through
        // String.replace on the matched segment to honor backrefs.
        let insert = replacement;
        if (singleRe) {
          try { insert = seg.replace(singleRe, replacement); } catch { insert = seg; }
        }
        return { from: mm.pos, to: mm.pos + mm.len, insert };
      });
      view.dispatch({ changes });
      if (onSync) onSync();
      setMatchCount(0); setCurrentMatch(0);
      return;
    }

    const re = buildRegex(searchText, true);
    if (!re) return;
    // Literal mode: escape $ in the REPLACEMENT too — String.replace treats
    // $&, $', $` etc. as substitution patterns, so a literal "$'" would splice
    // the rest of the document in at every match. Regex mode keeps backrefs.
    const newDoc = useRegexRef.current
      ? doc.replace(re, replacement)
      : doc.replace(re, replacement.replace(/\$/g, "$$$$"));

    if (newDoc !== doc) {
      view.dispatch({ changes: { from: 0, to: doc.length, insert: newDoc } });
      if (onSync) onSync();
    }

    setMatchCount(0);
    setCurrentMatch(0);
  }, [sourceRef, onSync, buildRegex, getMatchPositions, scopeMd]);

  // --- Tiptap search helpers ---

  /** All match ranges in the rich editor, in document order, honoring the
   *  regex / case-sensitive / whole-word / headings-only options. */
  const collectTiptapMatches = useCallback((editor: any, searchText: string): { from: number; to: number }[] => {
    const re = buildRegex(searchText, true);
    if (!re) return [];
    const ranges: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node: any, pos: number, parent: any) => {
      if (!node.isText) return;
      if (headingsOnlyRef.current && parent?.type?.name !== "heading") return;
      const t: string = node.text || "";
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(t)) !== null) {
        const from = pos + m.index;
        ranges.push({ from, to: from + m[0].length });
        if (m[0].length === 0) re.lastIndex++;
      }
    });
    return ranges;
  }, [buildRegex]);

  const findInTiptap = useCallback((searchText: string) => {
    if (!searchText) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }
    const tp = previewRef.current;
    if (!tp) return;
    const editor = tp.getEditor();
    if (!editor) return;

    const ranges = collectTiptapMatches(editor, searchText);
    setMatchCount(ranges.length);
    if (ranges.length === 0) {
      setCurrentMatch(0);
      return;
    }
    // Select the first match at/after the caret so live-typing keeps context;
    // fall back to the very first match.
    const caret = editor.state.selection.from;
    let idx = ranges.findIndex((r) => r.from >= caret);
    if (idx === -1) idx = 0;
    const r = ranges[idx]!;
    try {
      editor.commands.setTextSelection({ from: r.from, to: r.to });
    } catch (e) {
      console.warn("[FindReplace] Tiptap selection failed:", e);
    }
    setCurrentMatch(idx + 1);
  }, [previewRef, collectTiptapMatches]);

  /** Advance to the next/previous match in the rich editor (dir 1 / -1). */
  const findNextInTiptap = useCallback((searchText: string, direction = 1) => {
    const tp = previewRef.current;
    if (!tp || !searchText) return;
    const editor = tp.getEditor();
    if (!editor) return;
    const ranges = collectTiptapMatches(editor, searchText);
    setMatchCount(ranges.length);
    if (ranges.length === 0) {
      setCurrentMatch(0);
      return;
    }
    const sel = editor.state.selection;
    let idx: number;
    if (direction > 0) {
      idx = ranges.findIndex((r) => r.from >= sel.to);
      if (idx === -1) idx = 0; // wrap to top
    } else {
      idx = -1;
      for (let i = ranges.length - 1; i >= 0; i--) {
        if (ranges[i]!.to <= sel.from) { idx = i; break; }
      }
      if (idx === -1) idx = ranges.length - 1; // wrap to bottom
    }
    const r = ranges[idx]!;
    try {
      editor.chain().focus().setTextSelection({ from: r.from, to: r.to }).scrollIntoView().run();
    } catch (e) {
      console.warn("[FindReplace] Tiptap next failed:", e);
    }
    setCurrentMatch(idx + 1);
  }, [previewRef, collectTiptapMatches]);

  const replaceInTiptap = useCallback((searchText: string, replacement: string) => {
    const tp = previewRef.current;
    if (!tp) return;
    const editor = tp.getEditor();
    if (!editor) return;

    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, " ");

    if (useRegex) {
      try {
        // Route through buildRegex so whole-word wrapping matches Find/Next/highlight.
        const re = buildRegex(searchText, false);
        const match = re ? re.exec(selected) : null;
        if (re && match && match[0] === selected) {
          const expanded = selected.replace(re, replacement);
          editor.chain().focus().deleteSelection().insertContent(expanded).run();
          if (syncHtmlToMd) syncHtmlToMd();
          findNextInTiptap(searchText, 1);
        } else {
          findNextInTiptap(searchText, 1);
        }
      } catch {
        findNextInTiptap(searchText, 1);
      }
    } else {
      const eq = caseSensitiveRef.current
        ? selected === searchText
        : selected.toLowerCase() === searchText.toLowerCase();
      if (eq) {
        editor.chain().focus().deleteSelection().insertContent(replacement).run();
        if (syncHtmlToMd) syncHtmlToMd();
        findNextInTiptap(searchText, 1);
      } else {
        findNextInTiptap(searchText, 1);
      }
    }
  }, [previewRef, syncHtmlToMd, findNextInTiptap, useRegex, buildRegex]);

  const replaceAllInTiptap = useCallback((searchText: string, replacement: string) => {
    const tp = previewRef.current;
    if (!tp) return;
    const editor = tp.getEditor();
    if (!editor) return;
    if (!searchText) return;

    // Match against the document's TEXT nodes and replace via a ProseMirror
    // transaction — never against serialized getHTML(). A regex replace on HTML
    // can match inside tags/attributes (e.g. searching "div" or "1") and corrupt
    // the document; walking text nodes only ever touches user-visible text.
    const globalRe = buildRegex(searchText, true);
    if (!globalRe) return; // invalid regex
    // Regex mode supports $1… backreferences by re-applying the pattern to just
    // the matched substring; literal mode uses the replacement verbatim.
    const singleRe = useRegexRef.current ? buildRegex(searchText, false) : null;

    const { state } = editor;
    const ranges: { from: number; to: number; text: string }[] = [];
    state.doc.descendants((node: any, pos: number, parent: any) => {
      if (!node.isText) return;
      if (headingsOnlyRef.current && parent?.type?.name !== "heading") return;
      const text: string = node.text || "";
      globalRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = globalRe.exec(text)) !== null) {
        const matched = m[0];
        const from = pos + m.index;
        const to = from + matched.length;
        // Regex mode supports $1… backreferences by re-applying the pattern to
        // just the matched substring; literal mode uses the replacement verbatim.
        const repText = singleRe ? matched.replace(singleRe, replacement) : replacement;
        ranges.push({ from, to, text: repText });
        if (matched.length === 0) globalRe.lastIndex++; // avoid infinite loop
      }
    });

    if (ranges.length === 0) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    // Apply end-to-start so earlier positions remain valid as we edit.
    let tr = state.tr;
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = ranges[i]!;
      if (r.text) tr = tr.insertText(r.text, r.from, r.to);
      else tr = tr.delete(r.from, r.to);
    }
    editor.view.dispatch(tr);
    if (syncHtmlToMd) syncHtmlToMd();

    setMatchCount(0);
    setCurrentMatch(0);
  }, [previewRef, syncHtmlToMd, buildRegex]);

  // ── Apply formatting to ALL matches ─────────────────────────────────────
  // A style (bold/italic/underline/highlight) or case (upper/lower/title) is
  // applied to every match at once — the "add formatting via find & replace"
  // path. Marks are added via a ProseMirror transaction in the rich pane and by
  // wrapping the matched text in the markdown pane.
  const CM_WRAP: Record<string, [string, string]> = {
    bold: ["**", "**"],
    italic: ["*", "*"],
    underline: ["<u>", "</u>"],
    strike: ["~~", "~~"],
  };

  const formatAllInCM6 = useCallback((kind: string) => {
    const cm = sourceRef.current;
    if (!cm) return;
    if (!findText && !headingsOnlyRef.current) return;
    const view = cm.getView();
    if (!view) return;
    const doc = view.state.doc.toString();
    // With a query: scope its matches. Without one but "headings only" on: target
    // the full content of every heading — the "select all headings" affordance.
    const matches = findText
      ? scopeMd(getMatchPositions(doc, findText), doc)
      : mdHeadingRanges(doc).map(([s, e]) => ({ pos: s, len: e - s }));
    if (!matches.length) return;
    const changes = matches.map((mm) => {
      const seg = doc.slice(mm.pos, mm.pos + mm.len);
      let insert: string;
      if (kind === "highlight") insert = `<span style="background-color: #fef08a">${seg}</span>`;
      else if (kind === "upper" || kind === "lower" || kind === "title") insert = applyCase(seg, kind as CaseMode);
      else {
        const w = CM_WRAP[kind];
        insert = w ? `${w[0]}${seg}${w[1]}` : seg;
      }
      return { from: mm.pos, to: mm.pos + mm.len, insert };
    });
    view.dispatch({ changes });
    onSync?.();
  }, [sourceRef, findText, getMatchPositions, scopeMd, onSync]);

  const formatAllInTiptap = useCallback((kind: string) => {
    const tp = previewRef.current;
    if (!tp) return;
    if (!findText && !headingsOnlyRef.current) return;
    const editor = tp.getEditor();
    if (!editor) return;
    const { state } = editor;
    const ranges: { from: number; to: number; text: string; marks: any }[] = [];
    if (findText) {
      const globalRe = buildRegex(findText, true);
      if (!globalRe) return;
      state.doc.descendants((node: any, pos: number, parent: any) => {
        if (!node.isText) return;
        if (headingsOnlyRef.current && parent?.type?.name !== "heading") return;
        const text: string = node.text || "";
        globalRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = globalRe.exec(text)) !== null) {
          const from = pos + m.index;
          ranges.push({ from, to: from + m[0].length, text: m[0], marks: node.marks });
          if (m[0].length === 0) globalRe.lastIndex++;
        }
      });
    } else {
      // No query + "headings only": target every heading's full text content.
      state.doc.descendants((node: any, pos: number, parent: any) => {
        if (!node.isText || parent?.type?.name !== "heading") return;
        const text: string = node.text || "";
        if (text) ranges.push({ from: pos, to: pos + text.length, text, marks: node.marks });
      });
    }
    if (!ranges.length) return;
    const marks = state.schema.marks;
    const markType =
      kind === "bold" ? marks.bold
      : kind === "italic" ? marks.italic
      : kind === "underline" ? marks.underline
      : kind === "strike" ? marks.strike
      : null;
    let tr = state.tr;
    for (let i = ranges.length - 1; i >= 0; i--) {
      const r = ranges[i]!;
      if (markType) tr = tr.addMark(r.from, r.to, markType.create());
      else if (kind === "highlight" && marks.textStyle) tr = tr.addMark(r.from, r.to, marks.textStyle.create({ backgroundColor: "#fef08a" }));
      else if (kind === "upper" || kind === "lower" || kind === "title") tr = tr.replaceWith(r.from, r.to, state.schema.text(applyCase(r.text, kind as CaseMode), r.marks));
    }
    editor.view.dispatch(tr);
    syncHtmlToMd?.();
  }, [previewRef, findText, buildRegex, syncHtmlToMd]);

  const doFormatAll = useCallback((kind: string) => {
    if (readOnly) return;
    if (isMd) formatAllInCM6(kind);
    else formatAllInTiptap(kind);
  }, [readOnly, isMd, formatAllInCM6, formatAllInTiptap]);

  const doFind = useCallback(() => {
    if (isMd) findInCM6(findText);
    else findInTiptap(findText);
  }, [isMd, findText, findInCM6, findInTiptap]);

  const doFindNext = useCallback((dir = 1) => {
    if (isMd) findNextInCM6(findText, dir);
    else findNextInTiptap(findText, dir);
  }, [isMd, findText, findNextInCM6, findNextInTiptap]);

  // "Find all" — in the MD pane, place a real multi-range selection over every
  // match (CodeMirror supports multiple selections); in the rich pane, jump to
  // the first (all matches stay highlighted, and the scrollbar markers show them).
  const doFindAll = useCallback(() => {
    if (!findText) return;
    if (isMd) {
      const view = sourceRef.current?.getView?.();
      if (!view) return;
      const doc = view.state.doc.toString();
      const matches = scopeMd(getMatchPositions(doc, findText), doc);
      setMatchCount(matches.length);
      if (!matches.length) { setCurrentMatch(0); return; }
      try {
        const ranges = matches.map((m) => EditorSelection.range(m.pos, m.pos + m.len));
        view.dispatch({ selection: EditorSelection.create(ranges, 0), scrollIntoView: true });
        view.focus();
        setCurrentMatch(1);
      } catch {
        findInCM6(findText); // multi-selection unavailable — select the first
      }
    } else {
      findInTiptap(findText);
    }
  }, [isMd, findText, sourceRef, getMatchPositions, scopeMd, findInCM6, findInTiptap]);

  const doReplace = useCallback(() => {
    if (readOnly) return;
    if (isMd) replaceInCM6(findText, replaceText);
    else replaceInTiptap(findText, replaceText);
  }, [readOnly, isMd, findText, replaceText, replaceInCM6, replaceInTiptap]);

  const doReplaceAll = useCallback(() => {
    if (readOnly) return;
    if (isMd) replaceAllInCM6(findText, replaceText);
    else replaceAllInTiptap(findText, replaceText);
  }, [readOnly, isMd, findText, replaceText, replaceAllInCM6, replaceAllInTiptap]);

  const applyHighlights = useCallback(() => {
    const cm = sourceRef.current;
    const tp = previewRef.current;
    const rep = showReplace ? replaceText : undefined;

    if (isMd) {
      cm?.setSearchHighlight?.(findText, useRegex, rep);
      tp?.clearSearchHighlight?.();
    } else {
      tp?.setSearchHighlight?.(findText, useRegex, rep);
      cm?.clearSearchHighlight?.();
    }
  }, [findText, replaceText, showReplace, useRegex, isMd, sourceRef, previewRef]);

  useEffect(() => {
    applyHighlights();
    const t = setTimeout(applyHighlights, 120);
    return () => clearTimeout(t);
  }, [applyHighlights, mode]);

  useEffect(() => {
    return () => {
      sourceRef.current?.clearSearchHighlight?.();
      previewRef.current?.clearSearchHighlight?.();
    };
  }, [sourceRef, previewRef]);

  useEffect(() => {
    doFind();
  }, [findText, mdScope, caseSensitive, wholeWord, useRegex, doFind]);

  // Count headings for the "select all headings" affordance (headings-only on,
  // no query). Kept out of the hot find path — only recomputes when relevant.
  useEffect(() => {
    if (findText || !headingsOnly) { setHeadingCount(0); return; }
    try {
      if (isMd) {
        const view = sourceRef.current?.getView?.();
        if (view) { setHeadingCount(mdHeadingRanges(view.state.doc.toString()).length); return; }
      } else {
        const editor = previewRef.current?.getEditor?.();
        if (editor) {
          let c = 0;
          editor.state.doc.descendants((n: any) => { if (n.type?.name === "heading") c++; });
          setHeadingCount(c);
          return;
        }
      }
    } catch { /* editor not ready */ }
    setHeadingCount(0);
  }, [findText, headingsOnly, isMd, mode, sourceRef, previewRef]);

  // Format/case actions target all headings when the headings-only toggle is on
  // and there's no query — otherwise they operate on the current match set.
  const formatAllHeadings = !findText && headingsOnly && headingCount > 0;
  const canFormat = matchCount > 0 || formatAllHeadings;

  // ── Scrollbar match markers ──────────────────────────────────────────────
  // Vertical position (0–1 of scroll height) of every match, drawn as ticks over
  // the active pane's scrollbar so you can see where matches are at a glance.
  const [markers, setMarkers] = useState<number[]>([]);
  const getActiveScroller = useCallback((): HTMLElement | null => {
    if (isMd) return sourceRef.current?.getView?.()?.scrollDOM ?? null;
    const ed = previewRef.current?.getEditor?.();
    return ed ? (ed.view.dom.closest(".tiptap-editor-content")?.parentElement ?? null) : null;
  }, [isMd, sourceRef, previewRef]);

  /**
   * Recomputing marker geometry is expensive — `coordsAtPos` forces layout, once
   * per match — and `findText` updates on every keystroke, uncapped. Two bounds:
   * a short debounce so it runs once per pause rather than per keypress, and an
   * even SAMPLE (never a head slice, which would hide every tick below the top
   * of the document) so a query matching thousands of times stays cheap.
   */
  const MARKER_SAMPLE_CAP = 300;
  const sampleEvenly = useCallback(<T,>(items: T[]): T[] => {
    if (items.length <= MARKER_SAMPLE_CAP) return items;
    const step = items.length / MARKER_SAMPLE_CAP;
    const out: T[] = [];
    for (let i = 0; i < MARKER_SAMPLE_CAP; i++) out.push(items[Math.floor(i * step)]!);
    return out;
  }, []);

  /**
   * C4. The tick positions are FRACTIONS of the scroller's height, computed
   * once and stored — so they go stale the moment either the matches or that
   * height move. The effect below used to depend on `matchCount` and a set of
   * identity-stable callbacks, and `matchCount` is only ever a count: insert
   * twenty lines above the first match and the number is unchanged, so nothing
   * re-ran. Measured previously, the first tick was 18 percentage points
   * (~148px) out until the query was touched.
   *
   * There is no document-revision prop to depend on and adding one would mean
   * threading state through PE's memoized props, so the panel observes the pane
   * it is pointed at: a MutationObserver for edits (the direct "the document
   * changed" signal) and a ResizeObserver for the `scrollHeight` that is baked
   * into every fraction. Both only bump a counter; the recompute stays behind
   * the same 120ms debounce, so a burst of typing still costs one pass.
   */
  const [docRevision, setDocRevision] = useState(0);
  useEffect(() => {
    const scroller = getActiveScroller();
    if (!scroller) return;
    const content = scroller.querySelector(".cm-content, .ProseMirror") ?? scroller;
    let queued = false;
    const bump = () => {
      if (queued) return;               // coalesce a burst into one bump
      queued = true;
      queueMicrotask(() => { queued = false; setDocRevision((n) => n + 1); });
    };
    const mo = new MutationObserver(bump);
    mo.observe(content, { childList: true, characterData: true, subtree: true });
    const ro = new ResizeObserver(bump);
    ro.observe(scroller);
    ro.observe(content);
    return () => { mo.disconnect(); ro.disconnect(); };
  }, [getActiveScroller, findText]);

  useEffect(() => {
    if (!findText) { setMarkers([]); return; }
    const timer = setTimeout(() => {
      try {
        if (isMd) {
          const view = sourceRef.current?.getView?.();
          if (!view) { setMarkers([]); return; }
          const doc = view.state.doc.toString();
          const ms = sampleEvenly(scopeMd(getMatchPositions(doc, findText), doc));
          const H = view.scrollDOM.scrollHeight || 1;
          setMarkers(ms.map((m) => Math.min(1, Math.max(0, view.lineBlockAt(m.pos).top / H))));
        } else {
          const ed = previewRef.current?.getEditor?.();
          const scroller = ed?.view.dom.closest(".tiptap-editor-content")?.parentElement as HTMLElement | undefined;
          if (!ed || !scroller) { setMarkers([]); return; }
          const ranges = sampleEvenly(collectTiptapMatches(ed, findText));
          const sRect = scroller.getBoundingClientRect();
          const H = scroller.scrollHeight || 1;
          const fr: number[] = [];
          for (const r of ranges) {
            try { const c = ed.view.coordsAtPos(r.from); fr.push(Math.min(1, Math.max(0, (c.top - sRect.top + scroller.scrollTop) / H))); } catch { /* pos not laid out */ }
          }
          setMarkers(fr);
        }
      } catch { setMarkers([]); }
    }, 120);
    return () => clearTimeout(timer);
  }, [findText, isMd, matchCount, docRevision, mdScope, caseSensitive, wholeWord, useRegex, sourceRef, previewRef, getMatchPositions, scopeMd, collectTiptapMatches, sampleEvenly]);

  const handleClose = useCallback(() => {
    sourceRef.current?.clearSearchHighlight?.();
    previewRef.current?.clearSearchHighlight?.();
    onClose();
  }, [sourceRef, previewRef, onClose]);

  useEffect(() => {
    findInputRef.current?.focus();
  }, []);

  // ⌘F / ⌘H while already open (panel not remounted): switch the mode live.
  useEffect(() => {
    if (initialMode) setPanelMode(readOnly ? "find" : initialMode);
    else if (initialShowReplace && !readOnly) setPanelMode("replace");
  }, [initialMode, initialShowReplace, readOnly]);


  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Find and replace"
      onKeyDown={(e) => {
        // Esc closes from anywhere in the panel (e.g. after dragging, when focus
        // isn't in one of the inputs that already handle Esc).
        if (e.key === "Escape") { e.preventDefault(); handleClose(); return; }
        // ⌘F / ⌘H switch modes while focus is INSIDE the panel — the global
        // shortcut listener is scoped to the editor container, so it can't see
        // keystrokes here (the panel is a fixed overlay outside that container).
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); setPanelMode("find"); }
        else if (mod && e.key.toLowerCase() === "h" && !readOnly) { e.preventDefault(); setPanelMode("replace"); }
      }}
      data-dragging={dragging || undefined}
      className={
        "fixed z-40 w-[min(94vw,520px)] max-h-[calc(100dvh-8px)] overflow-y-auto rounded-lg border border-border shadow-2xl " +
        "bg-card/80 backdrop-blur-md transition-colors duration-200 " +
        "hover:bg-card/95 focus-within:bg-card/95 data-[dragging]:opacity-80 " +
        (pos ? "" : "right-4 top-16")
      }
      style={pos ? { left: pos.x, top: pos.y, right: "auto" } : undefined}
    >
      {/* Drag handle */}
      <MatchScrollbar getScroller={getActiveScroller} fractions={markers} />
      <div
        onPointerDown={startDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-grab items-center gap-2 rounded-t-lg border-b border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground select-none active:cursor-grabbing"
      >
        <GripHorizontal className="size-3.5 opacity-70" />
        <span>Find &amp; Replace</span>
        <Button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          aria-label="Close find and replace"
          title="Close (Esc)"
        >
          <X className="size-4" />
        </Button>
      </div>
      <Collapsible open={showReplace} onOpenChange={setShowReplace} className="flex flex-col gap-2 px-3 py-2.5">
        {/* Mode selector — Find vs Replace (replaces the old "Replace…" toggle),
            sits ABOVE the pane selector. Replace is disabled while read-only. */}
        <div className="inline-flex w-full rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setPanelMode("find")}
            className={cn("flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
              panelMode === "find" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            Find
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => { if (!readOnly) setPanelMode("replace"); }}
            title={readOnly ? "Replace is unavailable in read-only mode" : undefined}
            className={cn("flex-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              showReplace ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            Replace
          </button>
        </div>

        {/* Pane selector — MD vs Rich Text (default follows the cursor's pane). */}
        <div className="flex flex-wrap items-center gap-2">

          <ButtonGroup>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (mdAvailable) setSearchTarget("md"); }}
              variant={!mdAvailable ? "ghost" : isMd ? "secondary" : "ghost"}
              title={mdAvailable ? "Search Markdown pane" : "Markdown pane not visible"}
            >
              MD
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (textAvailable) setSearchTarget("richtext"); }}
              variant={!textAvailable ? "ghost" : !isMd ? "secondary" : "ghost"}
              title={textAvailable ? "Search Rich Text pane" : "Rich Text pane not visible"}
            >
              Rich Text
            </Button>
          </ButtonGroup>

          <div className="relative flex-1 min-w-[200px]">
            <Input
              ref={findInputRef}
              type="text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); doFindNext(e.shiftKey ? -1 : 1); }
                if (e.key === "Escape") { e.preventDefault(); handleClose(); }
              }}
              placeholder={isMd ? "Find in Markdown..." : "Find in Rich Text..."}
              className="h-7 w-full pr-12"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <span className={`text-[10px] tabular-nums font-medium ${regexError ? "text-destructive" : "text-muted-foreground"}`} title={regexError || ""}>
                {regexError ? "ERR" : matchCount > 0 ? `${currentMatch}/${matchCount}` : findText ? "0" : ""}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleCaseSensitive}
              aria-pressed={caseSensitive}
              variant={caseSensitive ? "secondary" : "ghost"}
              title="Match case"
            >
              <CaseSensitive />
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleWholeWord}
              aria-pressed={wholeWord}
              variant={wholeWord ? "secondary" : "ghost"}
              title="Whole word"
            >
              <WholeWord />
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { toggleRegex(); setRegexError(null); }}
              aria-pressed={useRegex}
              variant={useRegex ? "secondary" : "ghost"}
              title="Toggle Regular Expression Search"
            >
              <Regex />
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowScope((v) => !v)}
              aria-pressed={showScope || Object.values(mdScope).some((v) => v !== "off")}
              variant={Object.values(mdScope).some((v) => v !== "off") ? "secondary" : "ghost"}
              title="Scope filter — search only in, or exclude, headings / code / links / emphasis"
            >
              <Funnel />
            </Button>

            <div className="flex items-center rounded-md border border-border bg-background h-8">
              <Button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => doFindNext(-1)}
                variant="ghost"
                aria-label="Previous match"
                title="Previous (Shift+Enter)"
              >
                <ChevronUp />
              </Button>
              <Button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => doFindNext(1)}
                variant="ghost"
                aria-label="Next match"
                title="Next (Enter)"
              >
                <ChevronDown />
              </Button>
            </div>

          </div>
        </div>

        {/* MD scope/format filter — per region: off → only → exclude. Collapsible
            so it costs no space until opened; grouped + wraps for mobile. */}
        {showScope && (
          <div className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/30 p-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">Filter (Markdown pane)</span>
              <span
                className="cursor-help text-muted-foreground/70"
                aria-label="How the filter works"
                title="Click a chip to cycle it: off → only (search only inside that region) → exclude (skip it). Combine structure + formatting to target exactly what you mean."
              >
                <Info className="size-3.5" />
              </span>
            </div>
            {(["Structure", "Formatting"] as const).map((grp) => (
              <div key={grp} className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">{grp}</span>
                {SCOPE_REGIONS.filter((r) => r.group === grp).map((r) => {
                  const st = mdScope[r.id];
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => cycleScope(r.id)}
                      aria-pressed={st !== "off"}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                        st === "include" ? "border-primary bg-primary text-primary-foreground"
                        : st === "exclude" ? "border-destructive/50 bg-destructive/10 text-destructive"
                        : "border-border bg-background text-muted-foreground hover:bg-muted",
                      )}
                      title={st === "off" ? `Search only inside ${r.label}` : st === "include" ? `Only ${r.label} — click to exclude ${r.label}` : `Excluding ${r.label} — click to turn off`}
                    >
                      {st === "include" && <Check className="size-3" />}
                      {st === "exclude" && <Ban className="size-3" />}
                      <span className={cn(st === "exclude" && "line-through")}>{r.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="flex items-center gap-3 pt-0.5 text-[10px] text-muted-foreground/80">
              <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded border border-border bg-background" /> off</span>
              <span className="inline-flex items-center gap-1"><Check className="size-3 text-primary" /> only</span>
              <span className="inline-flex items-center gap-1"><Ban className="size-3 text-destructive" /> exclude</span>
            </div>
          </div>
        )}

        {/* Find mode: Find (next) + Find all (select every match). */}
        {panelMode === "find" && (
          <div className="flex items-center justify-end gap-2">
            <ButtonGroup>
              <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFindNext(1)} variant="secondary" title="Find next (Enter)">
                <Search /> <span>Find</span>
              </Button>
              <Button onMouseDown={(e) => e.preventDefault()} onClick={doFindAll} variant="secondary" title="Find all — select every match">
                <span>Find all</span>
              </Button>
            </ButtonGroup>
          </div>
        )}

        {/* Apply formatting to every match (styles + case) — Replace mode only,
            since it mutates. With headings scope = only + empty query it targets
            ALL headings ("select all headings"). Hidden in read-only mode. */}
        {!readOnly && panelMode === "replace" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">
            {formatAllHeadings ? `Format all headings (${headingCount}):` : "Format matches:"}
          </span>
          <ButtonGroup>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("bold")} disabled={!canFormat} variant="ghost" title="Bold"><Bold /></Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("italic")} disabled={!canFormat} variant="ghost" title="Italicize"><Italic /></Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("underline")} disabled={!canFormat} variant="ghost" title="Underline"><UnderlineIcon /></Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("highlight")} disabled={!canFormat} variant="ghost" title="Highlight"><Highlighter /></Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("upper")} disabled={!canFormat} variant="ghost" title="UPPERCASE" className="text-[11px] font-semibold">AA</Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("lower")} disabled={!canFormat} variant="ghost" title="lowercase" className="text-[11px] font-semibold">aa</Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("title")} disabled={!canFormat} variant="ghost" title="Title Case" className="text-[11px] font-semibold">Aa</Button>
          </ButtonGroup>
        </div>
        )}

        {!readOnly && (
        <CollapsibleContent className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") doReplace();
                if (e.key === "Escape") { e.preventDefault(); handleClose(); }
              }}
              placeholder="Replace with..."
              className="h-8"
            />
          </div>

          <ButtonGroup>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => doReplace()}
              variant="secondary"
              title="Replace"
            >
              <Replace />
              <span>Replace</span>
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => doReplaceAll()}
              variant="secondary"
              title="Replace All"
            >
              <ReplaceAll />
              <span>Replace All</span>
            </Button>
          </ButtonGroup>
        </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}
/** Fixed overlay drawing match ticks over the active pane's scrollbar. Tracks the
 *  scroller's on-screen rect (resize/scroll/layout) so the ticks stay aligned. */
function MatchScrollbar({ getScroller, fractions }: { getScroller: () => HTMLElement | null; fractions: number[] }) {
  const [rect, setRect] = useState<{ top: number; right: number; height: number } | null>(null);
  useEffect(() => {
    let ro: ResizeObserver | null = null;
    // The capture-phase scroll listener fires for ANY scroller on the page —
    // notably the editor panes the user scrolls constantly while searching —
    // but the pane's on-screen rect does not move when its content scrolls. Skip
    // the state update when the rect is unchanged so we don't force a re-render
    // (and a fresh portal) on every scroll frame.
    const update = () => {
      const el = getScroller();
      if (!el) { setRect((prev) => (prev === null ? prev : null)); return; }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && prev.top === r.top && prev.right === r.right && prev.height === r.height
          ? prev
          : { top: r.top, right: r.right, height: r.height }
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const el = getScroller();
    if (el && typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(update); ro.observe(el); }
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      ro?.disconnect();
    };
  }, [getScroller]);
  if (!rect || fractions.length === 0) return null;
  // Portaled to <body>: the Find/Replace panel uses backdrop-blur, which makes it
  // a containing block for position:fixed — so a fixed overlay nested inside it
  // would be positioned relative to the panel (off-screen) instead of the viewport.
  return createPortal(
    <div data-pf-portal className="pointer-events-none fixed z-30" style={{ left: rect.right - 9, top: rect.top, width: 6, height: rect.height }}>
      {fractions.map((f, i) => (
        <div key={i} className="absolute left-0 right-0 rounded-sm bg-primary" style={{ top: `calc(${f * 100}% - 1.5px)`, height: 3, opacity: 0.85 }} />
      ))}
    </div>,
    document.body,
  );
}
