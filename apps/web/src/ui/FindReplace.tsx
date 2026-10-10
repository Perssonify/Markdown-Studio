import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
    Collapsible,
    CollapsibleContent,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Ban, Bold, CaseSensitive, Check, ChevronDown, ChevronUp, Funnel, GripHorizontal, Highlighter, Info, Italic, Regex, Replace, ReplaceAll, Search, Underline as UnderlineIcon, WholeWord, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { RefObject, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorSelection } from "@codemirror/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { CodeMirrorPaneHandle } from "./CodeMirrorPane";
import type { TiptapPaneHandle } from "./TiptapPane";
import { MODES } from "../constants";
import { applyCase, type CaseMode } from "../formatting/case-transform";
import {
  compileFindQuery,
  expandReplacement,
  firstMatchFrom,
  MAX_FIND_MATCHES,
  mdCodeRanges,
  mdHeadingRanges,
  pickMatch,
  type FindMatch,
  type HighlightRange,
  type HighlightSpec,
} from "../formatting/find-engine";
import { FindSupersededError, FindTimeoutError, FindUnsafePatternError, runFind } from "../formatting/find-worker";
import { useUIStore } from "../store/preferences/uiStore";
import { isAltGraphInput } from "../utils/alt-graph";
import { MAX_PREVIEW_WIDGETS } from "./search-colors";
import { t, useT } from "../i18n";
export interface MatchPosition {
  pos: number;
  len: number;
}

/**
 * One match, in the target pane's positions. `input` is the string it was found
 * in (the whole markdown, or one rich-text node) and `base` where that string
 * starts — what `` $` ``/`$'`/group offsets are relative to.
 */
interface FoundRange {
  from: number;
  to: number;
  m: FindMatch;
  input: string;
  base: number;
}

/** Every match for one query in one revision of one pane's document. `doc` is
 *  that document (CodeMirror's Text / ProseMirror's Node — both immutable, so
 *  identity IS the revision): a set whose `doc` is not the pane's current one
 *  is stale and is recomputed before anything acts on it. */
interface MatchSet {
  key: string;
  doc: unknown;
  ranges: FoundRange[];
  truncated: boolean;
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
  { id: "headings", get label() { return t("find.regionHeadings"); }, group: "Structure" },
  { id: "code", get label() { return t("find.regionCode"); }, group: "Structure" },
  { id: "links", get label() { return t("find.regionLinks"); }, group: "Structure" },
  { id: "bold", get label() { return t("find.regionBold"); }, group: "Formatting" },
  { id: "italic", get label() { return t("find.regionItalic"); }, group: "Formatting" },
  { id: "strike", get label() { return t("find.regionStrike"); }, group: "Formatting" },
  { id: "highlight", get label() { return t("find.regionHighlight"); }, group: "Formatting" },
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

// Region range finders in raw Markdown text (approximate but robust). Headings
// and code come from find-engine, which shares the fence tracker with the rest
// of the markdown tools (a `# comment` in a code block is not a heading).
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

/** Apply the markdown-pane scope filter (per-region include / exclude). The
 *  Replace All that follows acts on exactly what survives it. */
function applyMdScope(ranges: FoundRange[], doc: string, sc: Record<ScopeRegion, ScopeState>): FoundRange[] {
  if (Object.values(sc).every((v) => v === "off")) return ranges;
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
  return ranges.filter((m) => {
    const len = m.to - m.from;
    if (anyInclude && !inRanges(m.from, len, includes)) return false; // must sit inside an included region
    if (overlaps(m.from, len, excludes)) return false; // …and outside every excluded one
    return true;
  });
}

// "Format matches" wrappers for the markdown pane.
const CM_WRAP: Record<string, [string, string]> = {
  bold: ["**", "**"],
  italic: ["*", "*"],
  underline: ["<u>", "</u>"],
  strike: ["~~", "~~"],
};

export interface FindReplaceBarProps {
  sourceRef: RefObject<CodeMirrorPaneHandle | null>;
  previewRef: RefObject<TiptapPaneHandle | null>;
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

/**
 * Find & Replace.
 *
 * Matching lives in ONE place (`computeMatches` → formatting/find-engine and
 * find-worker): the count, Next/Previous, Find all, Replace, Replace All,
 * Format matches, the scrollbar ticks and both panes' highlights all consume
 * the same MatchSet. A user REGEX runs in a Worker with a timeout, never on the
 * main thread (see find-worker), so an async step sits between a query and its
 * matches; anything that acts re-checks that the set still belongs to the
 * document the pane holds.
 */
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
  const t = useT();
  // Read-only mode: Find/Next/Prev stay available (read-only navigation), but
  // Replace / Replace All / Format matches mutate the document, so they're hidden.
  const readOnly = useUIStore((s) => s.readOnly);
  const [findText, setFindText] = useState(initialQuery ?? "");
  const [replaceText, setReplaceText] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  /** The match cap (MAX_FIND_MATCHES) was hit: the count is a lower bound. */
  const [truncated, setTruncated] = useState(false);
  /** A regex is still running in the Worker. */
  const [pending, setPending] = useState(false);
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
  // Search options are persisted.
  const [useRegex, setUseRegex] = useState(() => readFrBool(FR_REGEX_KEY));
  const [caseSensitive, setCaseSensitive] = useState(() => readFrBool(FR_CASE_KEY));
  const [wholeWord, setWholeWord] = useState(() => readFrBool(FR_WORD_KEY));
  // MD scope include/exclude filter (per region); persisted. The headings=include
  // case doubles as the old "headings only" toggle (used by both panes + format).
  const [mdScope, setMdScope] = useState<Record<ScopeRegion, ScopeState>>(() => readScope());
  const [showScope, setShowScope] = useState(false);
  const headingsOnly = mdScope.headings === "include";
  const cycleScope = useCallback((region: ScopeRegion) => {
    setMdScope((prev) => {
      const order: ScopeState[] = ["off", "include", "exclude"];
      const next = { ...prev, [region]: order[(order.indexOf(prev[region]) + 1) % 3]! };
      try { localStorage.setItem(FR_SCOPE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const [regexError, setRegexError] = useState<string | null>(null);

  const toggleRegex = useCallback(() => setUseRegex((v) => { writeFrBool(FR_REGEX_KEY, !v); return !v; }), []);
  const toggleCaseSensitive = useCallback(() => setCaseSensitive((v) => { writeFrBool(FR_CASE_KEY, !v); return !v; }), []);
  const toggleWholeWord = useCallback(() => setWholeWord((v) => { writeFrBool(FR_WORD_KEY, !v); return !v; }), []);

  const [searchTarget, setSearchTarget] = useState<"md" | "richtext">(
    // Prefer the pane the cursor was in; fall back to the visible view mode.
    initialTarget ?? (mode === MODES.HTML ? "richtext" : "md")
  );
  const findInputRef = useRef<HTMLInputElement>(null);
  const countId = useId();

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

  // Everything the async paths read, current at CALL time — no stale closures,
  // and no dependency churn re-creating every callback on each keystroke.
  const live = useRef({ findText, replaceText, useRegex, caseSensitive, wholeWord, mdScope, headingsOnly, isMd, readOnly });
  live.current = { findText, replaceText, useRegex, caseSensitive, wholeWord, mdScope, headingsOnly, isMd, readOnly };

  const getView = useCallback(() => sourceRef.current?.getView?.() ?? null, [sourceRef]);
  const getEditor = useCallback(() => previewRef.current?.getEditor?.() ?? null, [previewRef]);
  /** The target pane's current document (immutable, so identity = revision). */
  const currentDoc = useCallback(
    (): unknown => (live.current.isMd ? getView()?.state.doc : getEditor()?.state.doc) ?? null,
    [getView, getEditor]
  );

  // ── Matching ──────────────────────────────────────────────────────────────
  const cacheRef = useRef<MatchSet | null>(null);

  /** The MatchSet for the current query in the target pane's current document
   *  (cached per query + document revision). Throws the pattern's error. */
  const computeMatches = useCallback(async (): Promise<MatchSet | null> => {
    const L = live.current;
    if (!L.findText) return null;
    const pane = L.isMd ? "md" : "rich";
    const doc = currentDoc();
    if (!doc) return null;
    const key = [pane, L.findText, L.useRegex, L.caseSensitive, L.wholeWord, pane === "md" ? JSON.stringify(L.mdScope) : L.headingsOnly].join("\u0000");
    const cached = cacheRef.current;
    if (cached && cached.key === key && cached.doc === doc) return cached;

    const q = compileFindQuery(L.findText, { regex: L.useRegex, caseSensitive: L.caseSensitive, wholeWord: L.wholeWord }, pane);
    const texts: string[] = [];
    const bases: number[] = [];
    if (pane === "md") {
      texts.push(String(doc));
      bases.push(0);
    } else {
      // Per text node, as before — so the rich pane never matches across a
      // node boundary (which is also where the marks change).
      (doc as PMNode).descendants((node, p, parent) => {
        if (!node.isText) return;
        if (L.headingsOnly && parent?.type?.name !== "heading") return;
        texts.push(node.text || "");
        bases.push(p);
      });
    }
    const run = await runFind(q, texts, { isRegex: L.useRegex, maxMatches: MAX_FIND_MATCHES });
    let ranges: FoundRange[] = [];
    run.results.forEach((res, i) => {
      const base = bases[i]!;
      const input = texts[i]!;
      for (const m of res.matches) ranges.push({ from: base + m.index, to: base + m.index + m.length, m, input, base });
    });
    if (pane === "md") ranges = applyMdScope(ranges, texts[0]!, L.mdScope);
    const set: MatchSet = { key, doc, ranges, truncated: run.truncated };
    cacheRef.current = set;
    return set;
  }, [currentDoc]);

  /** computeMatches with its errors shown in the panel; null = nothing to act on. */
  const getMatches = useCallback(async (): Promise<MatchSet | null> => {
    try {
      const set = await computeMatches();
      setRegexError(null);
      return set;
    } catch (e) {
      if (e instanceof FindSupersededError) return null;
      cacheRef.current = null;
      setRegexError(e instanceof FindTimeoutError ? t("find.patternTooSlow") : e instanceof FindUnsafePatternError ? t("find.patternUnsafe") : e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [computeMatches, t]);

  const currentSelection = useCallback((): { from: number; to: number } | null => {
    if (live.current.isMd) {
      const view = getView();
      if (!view) return null;
      const { from, to } = view.state.selection.main;
      return { from, to };
    }
    const editor = getEditor();
    if (!editor) return null;
    const { from, to } = editor.state.selection;
    return { from, to };
  }, [getView, getEditor]);

  /** Select a match. The rich pane takes focus for Next/Previous (as it always
   *  has); find-as-you-type leaves focus in the Find box. */
  const selectRange = useCallback((r: { from: number; to: number }, focusRich: boolean) => {
    if (live.current.isMd) {
      getView()?.dispatch({ selection: { anchor: r.from, head: r.to }, scrollIntoView: true });
      return;
    }
    const editor = getEditor();
    if (!editor) return;
    try {
      if (focusRich) editor.chain().focus().setTextSelection({ from: r.from, to: r.to }).scrollIntoView().run();
      else editor.commands.setTextSelection({ from: r.from, to: r.to });
    } catch (e) {
      console.warn("[FindReplace] Tiptap selection failed:", e);
    }
  }, [getView, getEditor]);

  // ── Find-as-you-type and live counts ──────────────────────────────────────
  const [matchSet, setMatchSet] = useState<MatchSet | null>(null);
  const seqRef = useRef(0);
  const pendingSelectRef = useRef(false);
  /** The document the latest refresh was started for — finished OR still in
   *  the Worker. A document-change refresh for that same document would only
   *  supersede (and so kill) a job that is already answering it. */
  const requestedDocRef = useRef<unknown>(null);

  /** Recompute, publish the count and highlights, and (when `select`) select
   *  the match at or after the selection's start. The newest call wins. */
  const refresh = useCallback((select: boolean) => {
    if (select) pendingSelectRef.current = true;
    const seq = ++seqRef.current;
    requestedDocRef.current = currentDoc();
    if (!live.current.findText) {
      cacheRef.current = null;
      pendingSelectRef.current = false;
      setMatchSet(null);
      setMatchCount(0);
      setCurrentMatch(0);
      setTruncated(false);
      setPending(false);
      setRegexError(null);
      return;
    }
    setPending(live.current.useRegex);
    void getMatches().then((set) => {
      if (seq !== seqRef.current) return;
      const doSelect = pendingSelectRef.current;
      pendingSelectRef.current = false;
      setPending(false);
      setMatchSet(set);
      setMatchCount(set ? set.ranges.length : 0);
      setTruncated(!!set?.truncated);
      if (!set || set.ranges.length === 0) { setCurrentMatch(0); return; }
      const sel = currentSelection();
      if (!sel) return;
      if (doSelect) {
        const i = firstMatchFrom(set.ranges, sel.from);
        selectRange(set.ranges[i]!, false);
        setCurrentMatch(i + 1);
      } else {
        setCurrentMatch(set.ranges.findIndex((r) => r.from === sel.from && r.to === sel.to) + 1);
      }
    });
  }, [getMatches, currentSelection, selectRange, currentDoc]);

  // The query or an option changed: recompute and select (find-as-you-type).
  useEffect(() => {
    refresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findText, useRegex, caseSensitive, wholeWord, mdScope, searchTarget]);

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
   *
   * The same counter now also drives the live match COUNT and the highlights:
   * an edit re-matches the document (below). DOM changes that are not edits —
   * our own highlight decorations, a reflow — leave the document identical, and
   * that recompute returns at once.
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
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(bump) : null;
    if (ro) { ro.observe(scroller); ro.observe(content); }
    return () => { mo.disconnect(); if (ro) ro.disconnect(); };
  }, [getActiveScroller, findText]);

  // The DOCUMENT changed: recompute the count and highlights — but never move
  // the selection out from under someone who is typing.
  useEffect(() => {
    if (!live.current.findText) return;
    // Only the DOM moved (our own highlights, a reflow), or a refresh for this
    // very document is already done or on its way.
    if (requestedDocRef.current === currentDoc()) return;
    refresh(false);
  }, [docRevision, refresh, currentDoc]);

  // Push the matches to the target pane's highlighter (and clear the other).
  useEffect(() => {
    const cm = sourceRef.current;
    const tp = previewRef.current;
    const apply = () => {
      const set = matchSet;
      if (!set || set.ranges.length === 0) {
        cm?.clearSearchHighlight?.();
        tp?.clearSearchHighlight?.();
        return;
      }
      // A set computed for an older revision would paint the wrong text; the
      // pane has mapped the previous highlights, and the recompute is on its way.
      if (set.doc !== currentDoc()) return;
      const replaceMode = showReplace && replaceText !== "";
      let previews = 0;
      const ranges: HighlightRange[] = set.ranges.map((r) => {
        const h: HighlightRange = { from: r.from, to: r.to };
        if (r.m.indices) h.groups = r.m.indices.map((ix) => (ix ? [r.base + ix[0], r.base + ix[1]] : [0, 0]));
        if (replaceMode && previews < MAX_PREVIEW_WIDGETS) {
          const next = useRegex ? expandReplacement(replaceText, r.m, r.input) : replaceText;
          h.preview = next !== r.input.slice(r.m.index, r.m.index + r.m.length) ? next : null;
          previews++;
        }
        return h;
      });
      const spec: HighlightSpec = { ranges, replaceMode };
      if (isMd) {
        cm?.setSearchHighlight?.(spec);
        tp?.clearSearchHighlight?.();
      } else {
        tp?.setSearchHighlight?.(spec);
        cm?.clearSearchHighlight?.();
      }
    };
    apply();
    // Re-apply once a pane that has just been switched in has mounted.
    const timer = setTimeout(apply, 120);
    return () => clearTimeout(timer);
  }, [matchSet, showReplace, replaceText, useRegex, isMd, mode, sourceRef, previewRef, currentDoc]);

  useEffect(() => {
    return () => {
      sourceRef.current?.clearSearchHighlight?.();
      previewRef.current?.clearSearchHighlight?.();
    };
  }, [sourceRef, previewRef]);

  useEffect(() => {
    if (!findText) { setMarkers([]); return; }
    const timer = setTimeout(() => {
      try {
        const set = cacheRef.current;
        if (!set || set.doc !== currentDoc()) { setMarkers([]); return; }
        const ms = sampleEvenly(set.ranges);
        if (isMd) {
          const view = sourceRef.current?.getView?.();
          if (!view) { setMarkers([]); return; }
          const H = view.scrollDOM.scrollHeight || 1;
          setMarkers(ms.map((m) => Math.min(1, Math.max(0, view.lineBlockAt(m.from).top / H))));
        } else {
          const ed = previewRef.current?.getEditor?.();
          const scroller = ed?.view.dom.closest(".tiptap-editor-content")?.parentElement as HTMLElement | undefined;
          if (!ed || !scroller) { setMarkers([]); return; }
          const sRect = scroller.getBoundingClientRect();
          const H = scroller.scrollHeight || 1;
          const fr: number[] = [];
          for (const r of ms) {
            try { const c = ed.view.coordsAtPos(r.from); fr.push(Math.min(1, Math.max(0, (c.top - sRect.top + scroller.scrollTop) / H))); } catch { /* pos not laid out */ }
          }
          setMarkers(fr);
        }
      } catch { setMarkers([]); }
    }, 120);
    return () => clearTimeout(timer);
  }, [findText, isMd, matchCount, matchSet, docRevision, sourceRef, previewRef, sampleEvenly, currentDoc]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const doFindNext = useCallback(async (dir: 1 | -1 = 1) => {
    const set = await getMatches();
    if (!set) return;
    setMatchCount(set.ranges.length);
    setTruncated(set.truncated);
    if (set.ranges.length === 0) { setCurrentMatch(0); return; }
    const sel = currentSelection();
    if (!sel) return;
    const i = pickMatch(set.ranges, sel.from, sel.to, dir);
    selectRange(set.ranges[i]!, true);
    setCurrentMatch(i + 1);
  }, [getMatches, currentSelection, selectRange]);

  // "Find all" — in the MD pane, place a real multi-range selection over every
  // match (CodeMirror supports multiple selections); in the rich pane, jump to
  // the first (all matches stay highlighted, and the scrollbar markers show them).
  const doFindAll = useCallback(async () => {
    if (!live.current.findText) return;
    const set = await getMatches();
    if (!set) return;
    setMatchCount(set.ranges.length);
    if (set.ranges.length === 0) { setCurrentMatch(0); return; }
    if (live.current.isMd) {
      const view = getView();
      if (!view) return;
      try {
        const ranges = set.ranges.map((m) => EditorSelection.range(m.from, m.to));
        view.dispatch({ selection: EditorSelection.create(ranges, 0), scrollIntoView: true });
        view.focus();
        setCurrentMatch(1);
      } catch {
        selectRange(set.ranges[0]!, false); // multi-selection unavailable — select the first
        setCurrentMatch(1);
      }
    } else {
      const i = firstMatchFrom(set.ranges, currentSelection()?.from ?? 0);
      selectRange(set.ranges[i]!, false);
      setCurrentMatch(i + 1);
    }
  }, [getMatches, getView, currentSelection, selectRange]);

  /** The text a match becomes. Regex mode expands `$1`/`$&`/`$<name>` from the
   *  ORIGINAL match — re-running the pattern on the matched text alone is what
   *  made lookarounds (`\d+(?=px)`) count, highlight and never replace (A060).
   *  Literal mode inserts the replacement verbatim. */
  const replacementFor = useCallback((r: FoundRange) => {
    const L = live.current;
    return L.useRegex ? expandReplacement(L.replaceText, r.m, r.input) : L.replaceText;
  }, []);

  const doReplace = useCallback(async () => {
    if (live.current.readOnly) return;
    const set = await getMatches();
    if (!set) return;
    const sel = currentSelection();
    const r = sel ? set.ranges.find((x) => x.from === sel.from && x.to === sel.to) : undefined;
    // Replace acts on the SELECTED match; with none selected it finds one first.
    if (!r) { await doFindNext(1); return; }
    const text = replacementFor(r);
    if (live.current.isMd) {
      const view = getView();
      if (!view || view.state.doc !== set.doc) return;
      view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length } });
      onSync?.();
    } else {
      const editor = getEditor();
      if (!editor || editor.state.doc !== set.doc) return;
      // TEXT, never HTML. This went through insertContent(), which parses its
      // argument as HTML: replacing with "<b>x</b>" inserted a bold x, and a
      // "<" in the replacement could swallow what followed it.
      editor.chain().focus().command(({ tr }) => {
        if (text) tr.insertText(text, r.from, r.to);
        else tr.delete(r.from, r.to);
        return true;
      }).run();
      syncHtmlToMd?.();
    }
    await doFindNext(1);
  }, [getMatches, currentSelection, doFindNext, replacementFor, getView, getEditor, onSync, syncHtmlToMd]);

  const doReplaceAll = useCallback(async () => {
    if (live.current.readOnly || !live.current.findText) return;
    const set = await getMatches();
    if (!set || set.ranges.length === 0) { setMatchCount(0); setCurrentMatch(0); return; }
    if (live.current.isMd) {
      const view = getView();
      if (!view || view.state.doc !== set.doc) return;
      // One transaction over exactly the matches the count shows — the scope
      // filter's survivors, never an unscoped whole-document rewrite.
      view.dispatch({ changes: set.ranges.map((r) => ({ from: r.from, to: r.to, insert: replacementFor(r) })) });
      onSync?.();
    } else {
      const editor = getEditor();
      if (!editor || editor.state.doc !== set.doc) return;
      // Text nodes only, via a transaction — never a regex over getHTML(),
      // which could match inside tags and attributes. End-to-start so earlier
      // positions stay valid.
      let tr = editor.state.tr;
      for (let i = set.ranges.length - 1; i >= 0; i--) {
        const r = set.ranges[i]!;
        const text = replacementFor(r);
        tr = text ? tr.insertText(text, r.from, r.to) : tr.delete(r.from, r.to);
      }
      editor.view.dispatch(tr);
      syncHtmlToMd?.();
    }
    setMatchCount(0);
    setCurrentMatch(0);
  }, [getMatches, replacementFor, getView, getEditor, onSync, syncHtmlToMd]);

  // ── Apply formatting to ALL matches ─────────────────────────────────────
  // A style (bold/italic/underline/highlight) or case (upper/lower/title) is
  // applied to every match at once — the "add formatting via find & replace"
  // path. Marks are added via a ProseMirror transaction in the rich pane and by
  // wrapping the matched text in the markdown pane. With no query but "headings
  // only" on, it targets every heading's text instead.
  const doFormatAll = useCallback(async (kind: string) => {
    const L = live.current;
    if (L.readOnly) return;
    if (!L.findText && !L.headingsOnly) return;
    if (L.isMd) {
      const view = getView();
      if (!view) return;
      let spans: { from: number; to: number }[];
      if (L.findText) {
        const set = await getMatches();
        if (!set || view.state.doc !== set.doc) return;
        spans = set.ranges;
      } else {
        spans = mdHeadingRanges(view.state.doc.toString()).map(([s, e]) => ({ from: s, to: e }));
      }
      if (!spans.length) return;
      const doc = view.state.doc;
      const changes = spans.map((mm) => {
        const seg = doc.sliceString(mm.from, mm.to);
        let insert: string;
        if (kind === "highlight") insert = `<span style="background-color: #fef08a">${seg}</span>`;
        else if (kind === "upper" || kind === "lower" || kind === "title") insert = applyCase(seg, kind as CaseMode);
        else {
          const w = CM_WRAP[kind];
          insert = w ? `${w[0]}${seg}${w[1]}` : seg;
        }
        return { from: mm.from, to: mm.to, insert };
      });
      view.dispatch({ changes });
      onSync?.();
      return;
    }
    const editor = getEditor();
    if (!editor) return;
    let spans: { from: number; to: number }[];
    if (L.findText) {
      const set = await getMatches();
      if (!set || editor.state.doc !== set.doc) return;
      spans = set.ranges;
    } else {
      spans = [];
      editor.state.doc.descendants((node, p, parent) => {
        if (!node.isText || parent?.type?.name !== "heading") return;
        const text: string = node.text || "";
        if (text) spans.push({ from: p, to: p + text.length });
      });
    }
    if (!spans.length) return;
    const { state } = editor;
    const marks = state.schema.marks;
    const markType =
      kind === "bold" ? marks["bold"]
      : kind === "italic" ? marks["italic"]
      : kind === "underline" ? marks["underline"]
      : kind === "strike" ? marks["strike"]
      : null;
    const textStyle = marks["textStyle"];
    let tr = state.tr;
    for (let i = spans.length - 1; i >= 0; i--) {
      const r = spans[i]!;
      if (r.to <= r.from) continue;
      if (markType) tr = tr.addMark(r.from, r.to, markType.create());
      else if (kind === "highlight" && textStyle) {
        // MERGE into each run's existing textStyle. addMark REPLACES a mark of
        // the same type, and colour, highlight and font all live on textStyle —
        // so this used to wipe the text colour and font a run already had.
        state.doc.nodesBetween(r.from, r.to, (node, p) => {
          if (!node.isText) return;
          const from = Math.max(p, r.from);
          const to = Math.min(p + node.nodeSize, r.to);
          if (from >= to) return;
          const existing = node.marks.find((mk) => mk.type === textStyle);
          tr = tr.addMark(from, to, textStyle.create({ ...(existing?.attrs ?? {}), backgroundColor: "#fef08a" }));
        });
      } else if (kind === "upper" || kind === "lower" || kind === "title") {
        const text = state.doc.textBetween(r.from, r.to);
        const nodeMarks = state.doc.nodeAt(r.from)?.marks;
        tr = tr.replaceWith(r.from, r.to, state.schema.text(applyCase(text, kind as CaseMode), nodeMarks));
      }
    }
    editor.view.dispatch(tr);
    syncHtmlToMd?.();
  }, [getMatches, getView, getEditor, onSync, syncHtmlToMd]);

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
          editor.state.doc.descendants((n) => { if (n.type?.name === "heading") c++; });
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
      aria-label={t("find.findAndReplace")}
      onKeyDown={(e) => {
        // Esc closes from anywhere in the panel, the inputs included — ONE
        // handler: the inputs used to close on it too, so one Escape closed twice.
        if (e.key === "Escape") { e.preventDefault(); handleClose(); return; }
        // ⌘F / ⌘H switch modes while focus is INSIDE the panel — the global
        // shortcut listener is scoped to the editor container, so it can't see
        // keystrokes here (the panel is a fixed overlay outside that container).
        // AltGr is typing (Windows reports it as Ctrl+Alt) — never a mode switch.
        if (isAltGraphInput(e.nativeEvent)) return;
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
        <span>{t("find.panelTitle")}</span>
        <Button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          variant="ghost"
          size="icon"
          className="ml-auto size-6"
          aria-label={t("find.closeFindAndReplace")}
          title={t("find.closeEsc")}
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
            {t("find.find")}
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => { if (!readOnly) setPanelMode("replace"); }}
            title={readOnly ? t("find.replaceUnavailableReadOnly") : undefined}
            className={cn("flex-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              showReplace ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}
          >
            {t("common.replace")}
          </button>
        </div>

        {/* Pane selector — MD vs Rich Text (default follows the cursor's pane). */}
        <div className="flex flex-wrap items-center gap-2">

          <ButtonGroup>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (mdAvailable) setSearchTarget("md"); }}
              variant={!mdAvailable ? "ghost" : isMd ? "secondary" : "ghost"}
              title={mdAvailable ? t("find.searchMarkdownPane") : t("find.markdownPaneNotVisible")}
            >
              {t("find.paneMd")}
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (textAvailable) setSearchTarget("richtext"); }}
              variant={!textAvailable ? "ghost" : !isMd ? "secondary" : "ghost"}
              title={textAvailable ? t("find.searchRichTextPane") : t("find.richTextPaneNotVisible")}
            >
              {t("find.paneRichText")}
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
              }}
              placeholder={isMd ? t("find.findInMarkdownPlaceholder") : t("find.findInRichTextPlaceholder")}
              // A placeholder is not a label: it vanishes once text is typed
              // and is not reliably announced. The count is its description.
              aria-label={isMd ? t("find.findInMarkdown") : t("find.findInRichText")}
              aria-describedby={countId}
              aria-invalid={regexError ? true : undefined}
              className="h-7 w-full pr-12"
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <span
                id={countId}
                className={`text-[10px] tabular-nums font-medium ${regexError ? "text-destructive" : "text-muted-foreground"}`}
                title={regexError || (truncated ? t("find.showingFirstMatches", { count: matchCount }) : "")}
                aria-label={regexError ? t("find.errorLabel", { error: regexError }) : undefined}
              >
                {regexError ? t("find.errorBadge") : pending ? "…" : matchCount > 0 ? t(truncated ? "find.matchPositionTruncated" : "find.matchPosition", { current: currentMatch, count: matchCount }) : findText ? "0" : ""}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleCaseSensitive}
              aria-pressed={caseSensitive}
              variant={caseSensitive ? "secondary" : "ghost"}
              title={t("find.matchCase")}
            >
              <CaseSensitive />
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleWholeWord}
              aria-pressed={wholeWord}
              variant={wholeWord ? "secondary" : "ghost"}
              title={t("find.wholeWord")}
            >
              <WholeWord />
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { toggleRegex(); setRegexError(null); }}
              aria-pressed={useRegex}
              variant={useRegex ? "secondary" : "ghost"}
              title={t("find.toggleRegularExpressionSearch")}
            >
              <Regex />
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowScope((v) => !v)}
              aria-pressed={showScope || Object.values(mdScope).some((v) => v !== "off")}
              variant={Object.values(mdScope).some((v) => v !== "off") ? "secondary" : "ghost"}
              title={t("find.scopeFilterTitle")}
            >
              <Funnel />
            </Button>

            <div className="flex items-center rounded-md border border-border bg-background h-8">
              <Button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => doFindNext(-1)}
                variant="ghost"
                aria-label={t("find.previousMatch")}
                title={t("find.previousShiftEnter")}
              >
                <ChevronUp />
              </Button>
              <Button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => doFindNext(1)}
                variant="ghost"
                aria-label={t("find.nextMatch")}
                title={t("find.nextEnter")}
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
              <span className="text-[11px] font-medium text-muted-foreground">{t("find.filterTitle")}</span>
              <span
                className="cursor-help text-muted-foreground/70"
                aria-label={t("find.howTheFilterWorks")}
                title={t("find.filterHelp")}
              >
                <Info className="size-3.5" />
              </span>
            </div>
            {(["Structure", "Formatting"] as const).map((grp) => (
              <div key={grp} className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/70">{t(grp === "Structure" ? "find.groupStructure" : "find.groupFormatting")}</span>
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
                      title={st === "off" ? t("find.chipSearchOnlyInside", { region: r.label }) : st === "include" ? t("find.chipOnly", { region: r.label }) : t("find.chipExcluding", { region: r.label })}
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
              <span className="inline-flex items-center gap-1"><span className="inline-block size-2.5 rounded border border-border bg-background" /> {t("find.legendOff")}</span>
              <span className="inline-flex items-center gap-1"><Check className="size-3 text-primary" /> {t("find.legendOnly")}</span>
              <span className="inline-flex items-center gap-1"><Ban className="size-3 text-destructive" /> {t("find.legendExclude")}</span>
            </div>
          </div>
        )}

        {/* Find mode: Find (next) + Find all (select every match). */}
        {panelMode === "find" && (
          <div className="flex items-center justify-end gap-2">
            <ButtonGroup>
              <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFindNext(1)} variant="secondary" title={t("find.findNextEnter")}>
                <Search /> <span>{t("find.find")}</span>
              </Button>
              <Button onMouseDown={(e) => e.preventDefault()} onClick={doFindAll} variant="secondary" title={t("find.findAllSelectEveryMatch")}>
                <span>{t("find.findAll")}</span>
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
            {formatAllHeadings ? t("find.formatAllHeadings", { count: headingCount }) : t("find.formatMatches")}
          </span>
          <ButtonGroup>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("bold")} disabled={!canFormat} variant="ghost" title={t("find.formatBold")}><Bold /></Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("italic")} disabled={!canFormat} variant="ghost" title={t("find.formatItalicize")}><Italic /></Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("underline")} disabled={!canFormat} variant="ghost" title={t("find.formatUnderline")}><UnderlineIcon /></Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("highlight")} disabled={!canFormat} variant="ghost" title={t("find.formatHighlight")}><Highlighter /></Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("upper")} disabled={!canFormat} variant="ghost" title={t("find.caseUpper")} className="text-[11px] font-semibold">{t("find.caseUpperFace")}</Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("lower")} disabled={!canFormat} variant="ghost" title={t("find.caseLower")} className="text-[11px] font-semibold">{t("find.caseLowerFace")}</Button>
            <Button onMouseDown={(e) => e.preventDefault()} onClick={() => doFormatAll("title")} disabled={!canFormat} variant="ghost" title={t("find.caseTitle")} className="text-[11px] font-semibold">{t("find.caseTitleFace")}</Button>
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
              }}
              placeholder={t("find.replaceWithPlaceholder")}
              aria-label={t("find.replaceWith")}
              className="h-8"
            />
          </div>

          <ButtonGroup>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => doReplace()}
              variant="secondary"
              title={t("common.replace")}
            >
              <Replace />
              <span>{t("common.replace")}</span>
            </Button>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => doReplaceAll()}
              variant="secondary"
              title={t("find.replaceAll")}
            >
              <ReplaceAll />
              <span>{t("find.replaceAll")}</span>
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
