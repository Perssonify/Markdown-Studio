import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FileCode2, Mouse, MouseOff } from "lucide-react";
import { useThemeMode } from "../theme/useThemeMode";
import React, { forwardRef, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { MODES } from "../constants";
import { useUIStore } from "../store/uiStore";
import { CodeMirrorPane } from "./CodeMirrorPane";
import { Icons } from "./Icons";
import { TiptapPane } from "./TiptapPane";
import { DIVIDER_BASE_CLASS, DIVIDER_HIT_AREA, useDividerDrag } from "./use-divider-drag";
import { markdownHeadings } from "./scroll-anchors";
import { currentSplitShouldStack } from "./split-layout";

interface PaneHeaderProps {
  /** Only the topmost header sits under the floating workspace trigger. */
  clearsTrigger?: boolean;
  icon: React.ElementType;
  label: string;
  children?: React.ReactNode;
  headerRef?: RefObject<HTMLDivElement>;
}

/** Split-ratio bounds and the keyboard nudge, shared by the pointer and key paths. */
const RATIO_MIN = 0.15;
const RATIO_MAX = 0.85;
const RATIO_STEP = 0.02;
const clampRatio = (v: number) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, v));

function PaneHeader({ icon: IconComponent, label, children, headerRef, clearsTrigger }: PaneHeaderProps) {
  return (
    <div
      ref={headerRef}
      data-pane-header
      className={cn(
        "flex items-center justify-between gap-2 overflow-hidden pr-4 md:pl-4 py-2 bg-card/80 border-b border-border text-xs font-semibold tracking-wider",
        // A9. The 44px of left padding exists to clear the floating workspace
        // trigger, which is absolutely positioned at the TOP-LEFT of the editor
        // — so exactly one header sits under it. Applying it to every header
        // spent 44px of the second pane's width on a phone, which is where
        // width is scarcest and where the panes stack so the second header is
        // nowhere near the trigger.
        clearsTrigger ? "pl-11" : "pl-4",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <IconComponent className="w-4 h-4 text-primary/70" />
        {/* The active-pane cue is driven by `data-pane-focused` on the HEADER,
            styled in styles.css. It used to be a `text-muted-foreground!` here
            plus classList juggling in `setFocusStyle` — which removed
            `text-muted-foreground` (a different token, never applied) and added
            `text-primary` (which cannot beat `!important`). The label never
            changed colour in either direction, and the else branch accumulated
            a bogus class on every blur, leaving a 6px dot as the whole
            affordance. Don't race Tailwind specificity from JavaScript. */}
        <span data-pane-label className="truncate transition-colors duration-200">{label}</span>
        <span
          data-pane-dot
          className="size-1.5 rounded-full bg-primary transition-opacity duration-200 mr-1"
        />
      </div>
      {/* shrink-0 keeps the controls intact; the LABEL side yields instead. */}
      <div className="flex shrink-0 items-center gap-2">
        {children}
      </div>
    </div>
  );
}

interface SyncModePillsProps {
  syncMode: string;
  onSyncModeChange: (mode: string) => void;
}

/**
 * A096 / WCAG 2.5.3. These switches SHOW a one-word label and used to be NAMED
 * by a whole explanatory sentence ("Pasting keeps the formatting…"), which does
 * not contain the visible "Styled paste" — so "click Styled paste" found
 * nothing, and a screen reader read a paragraph as the control's name. The name
 * is now the visible label; the explanation is the DESCRIPTION.
 */
function SwitchExplainer({ id, text }: { id: string; text: string }) {
  return <span id={id} className="sr-only">{text}</span>;
}

function SyncModePills({ syncMode, onSyncModeChange }: SyncModePillsProps) {
  const styled = syncMode !== "clean";
  const descId = React.useId();
  const explainer =
    // Underline, sub/superscript and image sizing are written as inline HTML in
    // BOTH modes (addBaseRules) — only the <span style="…"> carrier is
    // mode-dependent, which is what this switch controls. Naming the wrong set
    // here is how fidelity.ts came to warn about formats Clean never touches.
    "Styled: keep text colour, highlight and font family as inline <span style> in the Markdown. Off (Clean): those are stripped. Underline, sub/superscript and image sizes are kept either way; text alignment is kept by neither.";
  return <div className="flex items-center space-x-1">
    <Label htmlFor="sync-mode" className="text-[10px] md:text-xs whitespace-nowrap" title={explainer}>
      Styled
    </Label>
    <Switch id="sync-mode" checked={styled} onCheckedChange={(checked) => onSyncModeChange(checked ? "styled" : "clean")} aria-label="Styled Markdown" aria-describedby={descId} />
    <SwitchExplainer id={descId} text={explainer} />
  </div>;
}

interface PasteStyledPillProps {
  pasteStyled: boolean;
  setPasteStyled: (styled: boolean) => void;
}

function PasteStyledPill({ pasteStyled, setPasteStyled }: PasteStyledPillProps) {
  // On by default and remembered. Hold Shift while pasting to do the opposite
  // once, whichever way this is set.
  const descId = React.useId();
  const explainer = pasteStyled
    ? "Pasting keeps the formatting you copied. Shift+paste to strip it once."
    : "Pasting strips formatting. Shift+paste to keep it once.";
  return <div className="flex items-center space-x-1">
    <Label htmlFor="paste-styled" className="text-[10px] md:text-xs whitespace-nowrap" title={explainer}>
      Styled paste
    </Label>
    <Switch id="paste-styled" checked={pasteStyled} onCheckedChange={setPasteStyled} aria-label="Styled paste" aria-describedby={descId} />
    <SwitchExplainer id={descId} text={explainer} />
  </div>;
}

interface ImageModePillsProps {
  showImages: boolean;
  setShowImages: (show: boolean) => void;
}

function ImageModePills({ showImages, setShowImages }: ImageModePillsProps) {

  return <div className="flex items-center space-x-1">
    <Label htmlFor="show-images" className="text-[10px] md:text-xs whitespace-nowrap" title="Show or hide images in the preview">
      Images
    </Label>
    <Switch id="show-images" checked={showImages} onCheckedChange={setShowImages} aria-label="Images in preview" />
  </div>;
}

interface MarkdownPaneProps {
  onChange?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  syncMode: string;
  onSyncModeChange: (mode: string) => void;
  onFocus?: () => void;
  headerRef?: RefObject<HTMLDivElement>;
  syncScroll?: boolean;
  onSyncScrollChange?: (sync: boolean) => void;
  isSplit?: boolean;
}

const MarkdownPane = React.memo(forwardRef<any, MarkdownPaneProps>(function MarkdownPane(
  { onChange, onKeyDown, syncMode, onSyncModeChange, onFocus, headerRef, syncScroll, onSyncScrollChange, isSplit },
  ref
) {
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark" || themeMode === undefined;
  return (
    <div className="flex flex-col flex-1 min-h-0 min-w-0 bg-background" onFocus={onFocus}>
      <PaneHeader icon={FileCode2} label="Markdown" headerRef={headerRef} clearsTrigger>
        <div className="flex items-center gap-2">
          <SyncModePills syncMode={syncMode} onSyncModeChange={onSyncModeChange} />
          {isSplit && (
            <Tooltip>
              <TooltipTrigger render={
                <button
                type="button"
                onClick={() => onSyncScrollChange?.(!syncScroll)}
                // E8. 16px against WCAG 2.5.8's 24px, and jammed against the
                // right edge on a phone. The icon stays 16px; the BUTTON grows
                // on coarse pointers, the same shape as the divider's fix.
                // Icon-only: its glyph must clear 3:1 (WCAG 1.4.11), which the
                // 70%-alpha accent did not (1.4:1 in amber).
                className="flex h-4 items-center justify-center pointer-coarse:h-8 pointer-coarse:w-8 [&_svg]:size-4 [&_svg]:text-primary-strong"
                // A toggle button keeps ONE name and reports its state through
                // aria-pressed; a name that flips between "Enable…" and
                // "Disable…" contradicts the pressed state it sits beside, and
                // aria-roledescription replaced the "toggle button" role a
                // screen reader would otherwise announce.
                aria-label="Sync scrolling"
                aria-pressed={syncScroll}
              >
                {syncScroll ? <Mouse /> : <MouseOff />}
              </button>
              }/>
              <TooltipContent side="bottom" className="text-[10px]">
                {syncScroll ? "Disable scroll sync" : "Enable scroll sync"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </PaneHeader>
      <div
        className="flex-1 min-h-0 relative bg-background"
        data-theme={isDark ? "dark" : "light"}
      >
        <CodeMirrorPane
          ref={ref}
          isDark={isDark}
          onChange={onChange}
          onKeyDown={onKeyDown}
          className="absolute inset-0 w-full h-full bg-background"
        />
      </div>
    </div>
  );
}));

interface HtmlPaneProps {
  isDark: boolean;
  onChange?: () => void;
  /** A pasted HTML payload plus the modifier state that goes with it. The
   *  modifier does NOT come from the ClipboardEvent — that type carries none
   *  (see TiptapPane.handlePaste). */
  onPaste?: (html: string, mods?: { shiftKey?: boolean }) => boolean;
  /** Ask for a link URL through the app's styled dialog (see LinkBubbleMenu). */
  onEditLink?: (currentUrl: string) => Promise<string | null>;

  pasteStyled: boolean;
  setPasteStyled: (styled: boolean) => void;
  onFocus?: () => void;
  headerRef?: RefObject<HTMLDivElement>;
  showImages: boolean;
  setShowImages: (show: boolean) => void;
}

const HtmlPane = React.memo(forwardRef<any, HtmlPaneProps>(function HtmlPane(
  { isDark, onChange, onPaste, onEditLink, pasteStyled, setPasteStyled, onFocus, headerRef, showImages, setShowImages },
  ref
) {
  return (
    <div
      className="flex flex-col flex-1 min-h-0 min-w-0 bg-background"
      onFocus={onFocus}
      {...(!showImages ? { "data-hide-images": "" } : {})}
    >
      <PaneHeader icon={Icons.HTML} label="HTML" headerRef={headerRef}>
        <div className="flex items-center gap-2">
          <ImageModePills showImages={showImages} setShowImages={setShowImages} />
          <PasteStyledPill pasteStyled={pasteStyled} setPasteStyled={setPasteStyled} />
        </div>
      </PaneHeader>
      <div className="flex-1 min-h-0 relative bg-background tiptap-preview" id="tiptap-preview">
        <TiptapPane
          ref={ref}
          isDark={isDark}
          onChange={onChange}
          onPaste={onPaste}
          onEditLink={onEditLink}
          className="absolute inset-0 w-full h-full overflow-y-auto bg-background text-foreground leading-relaxed prose dark:prose-invert max-w-none px-3"
        />
      </div>
    </div>
  );
}));

export interface EditorLayoutProps {
  mode: string;
  cmRef: RefObject<any>;
  tiptapRef: RefObject<any>;
  onMdChange?: () => void;
  onHtmlChange?: () => void;
  onHtmlPaste?: (html: string, mods?: { shiftKey?: boolean }) => boolean;
  /** Ask for a link URL through the app's styled dialog (see LinkBubbleMenu). */
  onEditLink?: (currentUrl: string) => Promise<string | null>;

  syncMode: string;
  onSyncModeChange: (mode: string) => void;
  pasteStyled: boolean;
  setPasteStyled: (styled: boolean) => void;
  onFocusMd?: () => void;
  onFocusHtml?: () => void;
  /** A FILE dropped onto either pane. Without a handler the browser default
   *  applies: it NAVIGATES the tab to the dropped file, taking the unsaved
   *  document with it. Text/HTML drags are left to CodeMirror and ProseMirror. */
  onFileDrop?: (files: FileList) => void;
}

// Memoized. Its props are stable by construction at the call site
// (PerssonifyEditor hoists every handler into a useCallback), so the panes —
// and the CodeMirror/TipTap views inside them — stop re-rendering on every
// unrelated render of the 2,500-line editor shell.
function EditorLayoutInner({
  mode,
  cmRef,
  tiptapRef,
  onMdChange,
  onHtmlChange,
  onHtmlPaste,
  onEditLink,
  syncMode,
  onSyncModeChange,
  pasteStyled,
  setPasteStyled,
  onFocusMd,
  onFocusHtml,
  onFileDrop,
}: EditorLayoutProps) {
  const showMd = mode === MODES.MD || mode === MODES.SPLIT;
  const showHtml = mode === MODES.HTML || mode === MODES.SPLIT;
  const isSplit = mode === MODES.SPLIT;
  const themeMode = useThemeMode();
  const isDark = themeMode === "dark" || themeMode === undefined;

  const mdHeaderRef = useRef<HTMLDivElement>(null);
  const htmlHeaderRef = useRef<HTMLDivElement>(null);

  const [showImages, setShowImages] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);

  // ── Resizable split ───────────────────────────────────────────────────────
  // First pane's fraction of the split (0–1). Divider is horizontal on mobile
  // (stacked) and vertical on desktop (side-by-side). Both use Pointer Events so
  // it works with mouse, touch, and pen.
  const [ratio, setRatio] = useState(0.5);
  // `isNarrow` decides stacked (column) vs side-by-side (row) for the split.
  // Side-by-side is the default and is kept "whenever space allows" — we only
  // stack below 640px, i.e. genuinely phone-width where two columns can't both
  // be usable. This is viewport-based (not sidebar-based) so toggling the sidebar
  // never unexpectedly flips the orientation. Defaults to side-by-side.
  const [isNarrow, setIsNarrow] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const readOnly = useUIStore((s) => s.readOnly);
  const editorFontSize = useUIStore((s) => s.editorFontSize);
  const editorLineHeight = useUIStore((s) => s.editorLineHeight);
  const readingWidth = useUIStore((s) => s.readingWidth);
  const focusMode = useUIStore((s) => s.focusMode);

  // Graceful transition: briefly fade the editor area whenever a view mode,
  // read-only, or focus mode is imposed, so panes/toolbar don't snap in/out.
  // Reflow restarts the CSS animation; opacity-only, so no layout cost and
  // editors never remount.
  useEffect(() => {
    const el = splitRef.current;
    if (!el) return;
    el.classList.remove("pf-mode-fade");
    void el.offsetWidth;
    el.classList.add("pf-mode-fade");
  }, [mode, readOnly, focusMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Stack the split panes below 768px — the breakpoint at which the menu bar
    // collapses to ☰ — but only when there is HEIGHT for two panes. A landscape
    // phone stacked them into 37-69px editors apiece (A100); see split-layout.ts
    // for why an upright phone ignores the keyboard-shrunk height.
    const update = () => setIsNarrow(currentSplitShouldStack(window));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const onDividerMove = useCallback((e: PointerEvent) => {
    if (!splitRef.current) return;
    const r = splitRef.current.getBoundingClientRect();
    const frac = isNarrow ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    setRatio(clampRatio(frac));
  }, [isNarrow]);

  // Arrows nudge by RATIO_STEP, Home/End jump to the clamps — the split was
  // pointer-exclusive before this, despite carrying role="separator".
  const onRatioKey = useCallback((dir: -1 | 1, toEnd: boolean) => {
    setRatio((r) => clampRatio(toEnd ? (dir < 0 ? RATIO_MIN : RATIO_MAX) : r + dir * RATIO_STEP));
  }, []);

  const { onPointerDown: startDrag, onKeyDown: onDividerKeyDown } = useDividerDrag({
    onMove: onDividerMove,
    orientation: isNarrow ? "horizontal" : "vertical",
    onKeyAdjust: onRatioKey,
  });

  const setFocusStyle = useCallback((headerEl: HTMLDivElement | null, focused: boolean) => {
    if (!headerEl) return;
    // One attribute; CSS owns the rest. Both the label colour and the dot are
    // keyed off it, so they cannot disagree the way they did when the dot used
    // an inline style (which worked) and the label used classList (which did not).
    if (focused) headerEl.setAttribute("data-pane-focused", "");
    else headerEl.removeAttribute("data-pane-focused");
  }, []);

  const handleFocusMd = useCallback(() => {
    setFocusStyle(mdHeaderRef.current, true);
    setFocusStyle(htmlHeaderRef.current, false);
    onFocusMd?.();
  }, [onFocusMd, setFocusStyle]);

  const handleFocusHtml = useCallback(() => {
    setFocusStyle(htmlHeaderRef.current, true);
    setFocusStyle(mdHeaderRef.current, false);
    onFocusHtml?.();
  }, [onFocusHtml, setFocusStyle]);

  // ── Scroll Synchronization ────────────────────────────────────────────
  // `bindTick` re-runs the binding effect: on first mount the TipTap editor
  // may not exist yet (async useEditor init), and with only stable refs in the
  // deps the effect would give up permanently — scroll sync silently dead
  // until the user toggled something. Retry briefly until both views exist.
  const [bindTick, setBindTick] = useState(0);
  useEffect(() => {
    if (!isSplit || !syncScroll) return;

    const cmView = cmRef.current?.getView();
    const tiptapEditor = tiptapRef.current?.getEditor();

    if (!cmView || !tiptapEditor) {
      if (bindTick < 25) {
        const t = setTimeout(() => setBindTick((n) => n + 1), 200);
        return () => clearTimeout(t);
      }
      return;
    }

    const cmScroller = cmView.scrollDOM;
    const tiptapScroller = tiptapEditor.view.dom.closest('.tiptap-editor-content')?.parentElement;

    if (!cmScroller || !tiptapScroller) return;

    // Value-based echo suppression (replaces the old 50ms timer). Writing
    // `scrollTop` fires an async 'scroll' on the destination; that echo would
    // bounce straight back and the two panes would fight, which is what made
    // the old timer-guarded sync feel jumpy (and it also dropped the user's
    // own scrolls landing inside the 50ms window). Instead we remember the
    // exact position we just wrote to each pane; when a scroll event arrives
    // whose position matches that write (±2px for sub-pixel rounding), it's
    // the echo — swallow it once and never re-drive from it. Real user
    // scrolls never match the pending write, so none are dropped.
    const expected: { cm: number | null; tiptap: number | null } = { cm: null, tiptap: null };

    // Heading-anchored piecewise-linear mapping. A single global percentage keeps
    // only the top and bottom aligned; because a section can render taller in one
    // pane than the other (code blocks, diagrams, tables), the middle drifts. Here
    // we pair up corresponding headings on both sides and interpolate BETWEEN the
    // matching anchors, so each section's scroll speed scales to its own relative
    // height and headings stay in line. Rebuilt lazily when either pane's scroll
    // height changes (edits / async renders). Falls back to a plain top↔bottom
    // (percentage) mapping when the document has no headings.
    let pairs: { cm: number; tt: number }[] = [];
    let lastCmH = -1;
    let lastTtH = -1;

    // Anchors carry their heading TEXT, not just a position: the two panes are
    // paired by matching text (below), never by array index. Index pairing
    // silently mis-aligned the whole document after any fenced code block that
    // contained a `#` comment line — measured 216px of drift.
    type Anchor = { top: number; key: string };
    const norm = (t: string) =>
      t.toLowerCase().replace(/[`*_~\[\]()#]/g, "").replace(/\s+/g, " ").trim();

    // Ask CodeMirror's parse tree rather than scanning lines with a regex. The
    // regex saw ATX headings only — unindented and unquoted — while the rich
    // side below collects every rendered h1-h6, setext and blockquote headings
    // included, so those anchors existed on one side and not the other. The
    // tree also decides fenced and indented code for us, which is what the
    // hand-rolled fence tracker here used to approximate.
    const cmHeadingTops = (): Anchor[] =>
      markdownHeadings(cmView.state).map((h) => ({
        top: cmView.lineBlockAt(h.from).top,
        key: norm(h.text),
      }));
    const ttHeadingTops = (): Anchor[] => {
      const sRect = tiptapScroller.getBoundingClientRect();
      return Array.from(
        tiptapScroller.querySelectorAll(
          ".ProseMirror h1,.ProseMirror h2,.ProseMirror h3,.ProseMirror h4,.ProseMirror h5,.ProseMirror h6",
        ),
      ).map((el) => ({
        top: (el as HTMLElement).getBoundingClientRect().top - sRect.top + tiptapScroller.scrollTop,
        key: norm((el as HTMLElement).textContent || ""),
      }));
    };

    const rebuild = () => {
      lastCmH = cmScroller.scrollHeight;
      lastTtH = tiptapScroller.scrollHeight;
      const cmT = cmHeadingTops();
      const ttT = ttHeadingTops();
      const cmMax = Math.max(0, cmScroller.scrollHeight - cmScroller.clientHeight);
      const ttMax = Math.max(0, tiptapScroller.scrollHeight - tiptapScroller.clientHeight);
      // Two-pointer match on heading text, in document order. Unmatched
      // headings on either side are skipped rather than shifting the pairing.
      const p: { cm: number; tt: number }[] = [{ cm: 0, tt: 0 }];
      let ci = 0;
      let ti = 0;
      while (ci < cmT.length && ti < ttT.length) {
        const a = cmT[ci]!;
        const b = ttT[ti]!;
        if (a.key !== b.key) {
          // Look ahead a bounded distance on the other side for the same text.
          const ahead = ttT.slice(ti + 1, ti + 5).findIndex((x) => x.key === a.key);
          if (ahead >= 0) { ti += ahead + 1; continue; }
          ci++;
          continue;
        }
        const cm = Math.min(a.top, cmMax);
        const tt = Math.min(b.top, ttMax);
        const prev = p[p.length - 1]!;
        if (cm > prev.cm && tt > prev.tt) p.push({ cm, tt }); // keep strictly increasing
        ci++;
        ti++;
      }
      const last = p[p.length - 1]!;
      if (cmMax > last.cm && ttMax > last.tt) p.push({ cm: cmMax, tt: ttMax });
      pairs = p;
    };

    const ensure = () => {
      // Watching scrollHeight looks like a heuristic to replace with a
      // ResizeObserver, and it is not: CodeMirror's scrollHeight is an ESTIMATE
      // that refines as you scroll into unmeasured lines, and the anchor tops
      // come from `lineBlockAt`, which refines with it. Rebuilding when that
      // number moves is what keeps the two panes in step. Swapping it for a
      // ResizeObserver on the scrollers was tried and measured: it observes the
      // box, not the estimate, so after a 25-step wheel gesture on a 40-section
      // note the panes sat five sections apart.
      if (pairs.length < 2 || cmScroller.scrollHeight !== lastCmH || tiptapScroller.scrollHeight !== lastTtH) rebuild();
    };

    const project = (
      from: HTMLElement,
      to: HTMLElement,
      fromKey: "cm" | "tt",
      toKey: "cm" | "tt",
      expectedKey: "cm" | "tiptap",
    ) => {
      ensure();
      if (pairs.length < 2) return; // no usable anchor span (e.g. one pane not scrollable)
      const s = from.scrollTop;
      let i = 0;
      while (i < pairs.length - 2 && pairs[i + 1]![fromKey] <= s) i++;
      const a = pairs[i]!;
      const b = pairs[i + 1]!;
      const span = b[fromKey] - a[fromKey];
      const frac = span > 0 ? (s - a[fromKey]) / span : 0;
      const target = Math.round(a[toKey] + frac * (b[toKey] - a[toKey]));
      expected[expectedKey] = target;
      to.scrollTop = target;
    };

    const handleCmScroll = () => {
      if (expected.cm !== null && Math.abs(cmScroller.scrollTop - expected.cm) <= 2) {
        expected.cm = null; // consume the echo of our own write
        return;
      }
      project(cmScroller, tiptapScroller, "cm", "tt", "tiptap");
    };

    const handleTiptapScroll = () => {
      if (expected.tiptap !== null && Math.abs(tiptapScroller.scrollTop - expected.tiptap) <= 2) {
        expected.tiptap = null;
        return;
      }
      project(tiptapScroller, cmScroller, "tt", "cm", "cm");
    };

    cmScroller.addEventListener('scroll', handleCmScroll, { passive: true });
    tiptapScroller.addEventListener('scroll', handleTiptapScroll, { passive: true });

    return () => {
      cmScroller.removeEventListener('scroll', handleCmScroll);
      tiptapScroller.removeEventListener('scroll', handleTiptapScroll);
    };
  }, [isSplit, syncScroll, cmRef, tiptapRef, bindTick]);

  // Both panes stay mounted at all times (the sync engine needs both editors
  // alive even in single-pane mode); non-visible ones are hidden via `hidden`.
  // In split, the first pane's size is driven by `ratio` and a draggable divider;
  // orientation is column (stacked) on narrow screens, row on wide.
  const mdStyle = isSplit && showMd && showHtml
    ? { flexGrow: 0, flexShrink: 0, flexBasis: `${ratio * 100}%` }
    : undefined;

  // A file dropped on the editor must not navigate the tab away — that is the
  // browser default for an unhandled drop, and it discards everything typed
  // since the last autosave. Only FILE drags are intercepted; a text or HTML
  // drag inside the document falls through to the panes' own handling.
  const hasFiles = (e: React.DragEvent) =>
    !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = onFileDrop ? "copy" : "none";
  }, [onFileDrop]);
  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();          // never navigate, even with no importer wired
    const files = e.dataTransfer?.files;
    if (files?.length && onFileDrop) onFileDrop(files);
  }, [onFileDrop]);

  return (
    <div
      ref={splitRef}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      data-tour="editor"
      className={cn(
        "relative flex min-h-0 w-full flex-1",
        isSplit ? (isNarrow ? "flex-col" : "flex-row") : "flex-row"
      )}
      style={{
        // Typography vars are read by .ProseMirror / [data-md-preview] / .cm-content
        // (styles.css + cmTheme). Reading width caps the CONTENT column only.
        "--editor-font-size": `${editorFontSize}px`,
        "--editor-line-height": String(editorLineHeight),
        // `ch`, not `px`: a reading measure is a number of CHARACTERS, so it must
  // scale with the font-size preference — and a pixel cap set on the container
  // wrapping both panes never bound in the default split layout at all.
  "--reading-width": readingWidth ? `${readingWidth}ch` : "none",
      } as React.CSSProperties}
    >
      {/* data-print-pane: printing prints the RICH pane, whatever the view
          (styles.css @media print) — both panes are always mounted. */}
      <div
        data-print-pane="md"
        className={cn("flex min-h-0 min-w-0 flex-col", !isSplit && "flex-1 w-full", !showMd && "hidden")}
        style={mdStyle}
      >
        <MarkdownPane
          ref={cmRef}
          onChange={onMdChange}
          syncMode={syncMode}
          onSyncModeChange={onSyncModeChange}
          onFocus={handleFocusMd}
          headerRef={mdHeaderRef}
          syncScroll={syncScroll}
          onSyncScrollChange={setSyncScroll}
          isSplit={isSplit}
        />
      </div>

      {isSplit && showMd && showHtml && (
        <div
          role="separator"
          data-print-hide
          aria-orientation={isNarrow ? "horizontal" : "vertical"}
          aria-label="Resize panes"
          // A separator that reports no value is not operable by assistive tech
          // even once it is focusable, so the ratio is exposed as a percentage.
          tabIndex={0}
          aria-valuenow={Math.round(ratio * 100)}
          aria-valuemin={Math.round(RATIO_MIN * 100)}
          aria-valuemax={Math.round(RATIO_MAX * 100)}
          aria-valuetext={`${Math.round(ratio * 100)}% to the ${isNarrow ? "top" : "left"} pane`}
          onPointerDown={startDrag}
          onKeyDown={onDividerKeyDown}
          className={cn(
            "group relative z-10 flex shrink-0 items-center justify-center bg-border transition-colors hover:bg-primary/40",
            DIVIDER_BASE_CLASS,
            DIVIDER_HIT_AREA[isNarrow ? "horizontal" : "vertical"],
            isNarrow ? "h-1 w-full cursor-row-resize" : "w-1 h-full cursor-col-resize"
          )}
        >
          {/* Pullout grab handle — larger touch target, easy to find on mobile. */}
          <div
            className={cn(
              "absolute rounded-full bg-muted-foreground/40 transition-colors group-hover:bg-primary",
              isNarrow ? "h-1.5 w-10" : "h-10 w-1.5"
            )}
          />
        </div>
      )}

      <div
        data-print-pane="rich"
        className={cn("flex min-h-0 min-w-0 flex-col", isSplit ? "flex-1" : "flex-1 w-full", !showHtml && "hidden")}
      >
        <HtmlPane
          ref={tiptapRef}
          isDark={isDark}
          onChange={onHtmlChange}
          onPaste={onHtmlPaste}
          onEditLink={onEditLink}
          pasteStyled={pasteStyled}
          setPasteStyled={setPasteStyled}
          onFocus={handleFocusHtml}
          headerRef={htmlHeaderRef}
          showImages={showImages}
          setShowImages={setShowImages}
        />
      </div>
    </div>
  );
}

const EditorLayout = React.memo(EditorLayoutInner);

export { EditorLayout, HtmlPane, MarkdownPane };

