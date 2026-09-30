import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type Extension, type Range, RangeSetBuilder, StateEffect, StateField, Transaction } from "@codemirror/state";
import { placeholder as cmPlaceholder, Decoration, DecorationSet, drawSelection, EditorView, keymap, lineNumbers, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { CSSProperties, forwardRef, KeyboardEvent, useEffect, useImperativeHandle, useRef } from "react";
import {
  GROUP_STYLES, MAX_PREVIEW_WIDGETS,
  REPLACE_NEW_STYLE,
  REPLACE_OLD_STYLE,
} from "./search-colors";
import { COMPOSITION_STALL_MS } from "../constants";
import { perLineTextDirection } from "../extensions/cm-bidi";
import { assetRefsInMarkdown } from "../extensions/cm-asset-refs";
import type { HighlightSpec } from "../formatting/find-engine";
import { useUIStore } from "../store/uiStore";
import { dropAltGraphChords } from "../utils/alt-graph";

/** Read-only extension pair for the editability compartment. */
const roExt = (ro: boolean): Extension[] => [EditorState.readOnly.of(ro), EditorView.editable.of(!ro)];

/** New highlights from the Find panel (null clears them). */
const setSearchHighlights = StateEffect.define<HighlightSpec | null>();
const searchHighlightMark = Decoration.mark({ class: "cm-searchMatch" });
const replaceOldMark = Decoration.mark({
  class: "cm-replaceOld",
  attributes: { style: REPLACE_OLD_STYLE },
});

class ReplacePreviewWidget extends WidgetType {
  text: string;
  constructor(text: string) { super(); this.text = text; }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    span.setAttribute("style", REPLACE_NEW_STYLE);
    return span;
  }
  override eq(other: ReplacePreviewWidget) { return this.text === other.text; }
}

const groupMarks = GROUP_STYLES.map((s, i) =>
  Decoration.mark({ class: `cm-searchGroup cm-searchGroup-${i + 1}`, attributes: { style: s } })
);

/**
 * Search highlights, drawn from the RANGES the Find panel computed — the same
 * matches it counts and navigates. This field used to re-run the query itself
 * with a hard-coded "gi" (so a case-sensitive or whole-word search highlighted
 * text it did not count), located literal terms by `toLowerCase().indexOf`
 * (misaligned after any "İ", which lower-cases to two code units), and ran the
 * user's regex on the main thread yet again. Between updates from the panel,
 * the decorations are mapped through edits.
 */
function buildSearchHighlights(spec: HighlightSpec, docLength: number): DecorationSet {
  const decos: Range<Decoration>[] = [];
  let widgets = 0;
  for (const r of spec.ranges) {
    // Zero-length matches (`^`, a lookahead) have nothing to paint.
    if (r.to <= r.from || r.from < 0 || r.to > docLength) continue;
    if (spec.replaceMode) {
      decos.push(replaceOldMark.range(r.from, r.to));
      if (r.preview != null && widgets < MAX_PREVIEW_WIDGETS) {
        decos.push(Decoration.widget({ widget: new ReplacePreviewWidget(r.preview), side: 1 }).range(r.to));
        widgets++;
      }
    } else {
      decos.push(searchHighlightMark.range(r.from, r.to));
      r.groups?.forEach(([gFrom, gTo], g) => {
        if (g < groupMarks.length && gTo > gFrom && gFrom >= 0 && gTo <= docLength) decos.push(groupMarks[g]!.range(gFrom, gTo));
      });
    }
  }
  return Decoration.set(decos, true);
}

const searchHighlightField = StateField.define<DecorationSet>({
  create() { return Decoration.none; },
  update(decos, tr) {
    for (const e of tr.effects) {
      if (e.is(setSearchHighlights)) {
        return e.value ? buildSearchHighlights(e.value, tr.state.doc.length) : Decoration.none;
      }
    }
    return tr.docChanged ? decos.map(tr.changes) : decos;
  },
  provide: f => EditorView.decorations.from(f),
});

const perssonifyHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: "700", fontSize: "1.4em", color: "var(--primary-strong, #b45309)" },
  { tag: tags.heading2, fontWeight: "700", fontSize: "1.25em", color: "var(--primary-strong, #b45309)" },
  { tag: tags.heading3, fontWeight: "600", fontSize: "1.15em", color: "var(--primary-strong, #b45309)" },
  { tag: tags.heading4, fontWeight: "600", color: "var(--primary-strong, #b45309)" },
  { tag: tags.heading5, fontWeight: "600", color: "var(--primary-strong, #b45309)" },
  { tag: tags.heading6, fontWeight: "600", color: "var(--primary-strong, #b45309)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", opacity: "0.6" },
  { tag: tags.link, color: "var(--primary-strong, #b45309)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--muted-foreground, #78716c)" },
  { tag: tags.monospace, fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: "0.9em" },
  { tag: tags.quote, color: "var(--muted-foreground, #78716c)", fontStyle: "italic" },
  { tag: tags.list, color: "var(--primary-strong, #b45309)" },
  { tag: tags.meta, color: "#78716c" }, 
  { tag: tags.processingInstruction, color: "#78716c" }, 
]);

// ── Hanging-indent for wrapped list lines ────────────────────────────────────
// With line wrapping on, a long list item's continuation lines wrap back to
// column 0 by default, breaking under the marker. This plugin gives each list
// line a hanging indent (padding-left = the content offset, text-indent =
// -offset so the first line — which already contains the marker — still starts
// at column 0). Wrapped lines then align under the list TEXT, not the bullet.
// Nested lists indent further automatically (offset counts leading whitespace).
const LIST_MARKER = /^(\s*)(?:[-*+]|\d{1,9}[.)])(\s+)/;

const listHangingIndent = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to; ) {
          const line = view.state.doc.lineAt(pos);
          const m = LIST_MARKER.exec(line.text);
          if (m) {
            const ch = m[0].length; // columns to the start of the item text
            builder.add(
              line.from,
              line.from,
              Decoration.line({
                attributes: { style: `text-indent:-${ch}ch;padding-left:${ch}ch` },
              })
            );
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (v) => v.decorations }
);

// Single CSS-variable-driven theme — no swap needed on dark/light toggle.
// All colors are resolved from CSS custom properties so they inherit the
// transition already applied to the document root, eliminating flicker.
function cmTheme() {
  return EditorView.theme({
    "&": {
      backgroundColor: "var(--background) !important",
      color: "var(--foreground)",
      height: "100%",
      transition: "background-color 300ms, color 300ms",
    },
    ".cm-content": {
      caretColor: "var(--primary)",
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      // Typography prefs ride in via CSS vars set on the editor container
      // (EditorPanes splitRef); CSS vars resolve at paint, matching this file's
      // color-as-CSS-var philosophy — no compartment needed for size/height.
      fontSize: "var(--editor-font-size, 13px)",
      lineHeight: "var(--editor-line-height, 1.6)",
      padding: "12px calc(var(--spacing) * 3)",
      // Reading width caps the text column for a comfortable measure. Unlike the
      // rich pane we do NOT margin-inline:auto — `.cm-content` is a flex sibling
      // of the line-number gutter, and centering the capped content would leave a
      // visible gap between the gutter and the text. Left-aligning next to the
      // gutter keeps them attached while still shortening the line length.
      maxWidth: "var(--reading-width, none)",
    },
    ".cm-cursor": { borderLeftColor: "var(--primary)" },
    ".cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--primary) 15%, transparent) !important" },
    "&.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent) !important" },
    ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--foreground) 3%, transparent)" },
    ".cm-activeLineGutter": { backgroundColor: "color-mix(in srgb, var(--foreground) 5%, transparent)" },
    ".cm-gutters": {
      backgroundColor: "var(--background) !important",
      color: "var(--muted-foreground)",
      border: "none",
      borderRight: "1px solid var(--border)",
      transition: "background-color 300ms, color 300ms",
    },
    ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 12px", minWidth: "32px" },
    ".cm-foldGutter": { padding: "0 4px" },
    ".cm-scroller": { overflow: "auto", scrollbarWidth: "thin", scrollbarColor: "color-mix(in srgb, var(--foreground) 15%, transparent) transparent" },
    "& .cm-scroller::-webkit-scrollbar": { width: "7px", height: "7px" },
    "& .cm-scroller::-webkit-scrollbar-track": { background: "transparent" },
    "& .cm-scroller::-webkit-scrollbar-thumb": { background: "color-mix(in srgb, var(--foreground) 15%, transparent)", borderRadius: "4px" },
    "& .cm-scroller::-webkit-scrollbar-thumb:hover": { background: "color-mix(in srgb, var(--foreground) 30%, transparent)" },
    "& .cm-scroller::-webkit-scrollbar-corner": { background: "transparent" },
    "&.cm-focused": { outline: "none" },
    ".cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)", outline: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)" },
    ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--primary) 40%, transparent)", borderRadius: "2px" },
    ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "color-mix(in srgb, var(--primary) 65%, transparent)" },
    ".cm-selectionMatch": { backgroundColor: "color-mix(in srgb, var(--primary) 15%, transparent)" },
  });
}

export interface CodeMirrorPaneProps {
  isDark: boolean;
  defaultValue?: string;
  /** Fires on every edit. It carries NO payload on purpose: the sync engine
   *  reads the pane content itself when it projects, and serializing the whole
   *  document on every keystroke just to hand over a value nobody read cost a
   *  full rope flatten of the document per keypress. */
  onChange?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
  style?: CSSProperties;
}

export interface CodeMirrorPaneHandle {
  getValue: () => string;
  /** Replace the document. Returns the text the pane settled on, or null when
   *  there is no live view (nothing was written, so callers must not record it). */
  setValue: (md: string) => string | null;
  /** True while an IME / voice-dictation composition is active. The sync engine
   *  consults this so a cross-pane re-projection never dispatches into this pane
   *  mid-composition (which aborts it and drops the streamed text). */
  isComposing: () => boolean;
  getSelection: () => { from: number; to: number; text: string };
  getCursorPos: () => number;
  focus: () => void;
  dispatch: (tr: Transaction) => void;
  getView: () => EditorView | null;
  getCurrentLine: () => { text: string; from: number; to: number; number: number };
  replaceRange: (from: number, to: number, text: string) => void;
  insertAtCursor: (text: string) => void;
  wrapSelection: (before: string, after: string) => void;
  /** Draw the Find panel's matches (see buildSearchHighlights). */
  setSearchHighlight: (spec: HighlightSpec) => void;
  clearSearchHighlight: () => void;
}

export const CodeMirrorPane = forwardRef<CodeMirrorPaneHandle, CodeMirrorPaneProps>(
  function CodeMirrorPane({ isDark: _isDark, defaultValue, onChange, onKeyDown, className, style }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const extensionsRef = useRef<Extension[]>([]);
    const themeCompartment = useRef(new Compartment());
    const editableCompartment = useRef(new Compartment());
    const spellcheckCompartment = useRef(new Compartment());
    const onChangeRef = useRef(onChange);
    const suppressNextUpdate = useRef(false);
    // When this pane last produced input while composing (COMPOSITION_STALL_MS).
    const composeStampRef = useRef(0);
    const readOnly = useUIStore((s) => s.readOnly);
    const readOnlyRef = useRef(readOnly);
    readOnlyRef.current = readOnly;
    const spellcheck = useUIStore((s) => s.spellcheck);
    const spellcheckRef = useRef(spellcheck);
    spellcheckRef.current = spellcheck;

    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

    useEffect(() => {
      if (!containerRef.current || viewRef.current) {
        return;
      }

      // The composition's OWN begin/end events own the stamp. Deriving it only
      // from updates left it stale between two dictations: with no intervening
      // call to isComposing() to clear it, the next composition started against
      // a timestamp minutes old and was declared stuck on its very first check
      // — a projection could then dispatch into a live composition, which is
      // the exact bug the guard exists to prevent.
      const compositionEvents = EditorView.domEventHandlers({
        compositionstart: () => { composeStampRef.current = Date.now(); return false; },
        compositionend: () => { composeStampRef.current = 0; return false; },
      });

      const updateListener = EditorView.updateListener.of((update) => {
        // Liveness stamp for isComposing() — a composition that is producing
        // input is real; see COMPOSITION_STALL_MS.
        if (update.docChanged && update.view.composing) composeStampRef.current = Date.now();
        // Never report a change while read-only. The editability compartment
        // is the lock; this is the belt to it: whatever reaches the document
        // while the session is read-only must not be synced, dirtied or saved.
        if (update.docChanged && !suppressNextUpdate.current && !readOnlyRef.current) {
          onChangeRef.current?.();
        }
        suppressNextUpdate.current = false;
      });

      const themeExt = themeCompartment.current.of(cmTheme());

      // Kept in a ref so resetHistory() can rebuild a fresh EditorState (which
      // re-initialises the history field) around the current document.
      extensionsRef.current = [
        history(),
        // Minus the Ctrl+Alt+<character> bindings: off the Mac those ARE AltGr
        // typing (`Mod-Alt-\` ate the backslash on most European layouts).
        keymap.of(dropAltGraphChords([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab])),
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(perssonifyHighlight),
        lineNumbers(),
        EditorView.lineWrapping,
        listHangingIndent, // wrapped list lines hang-indent under the item text
        perLineTextDirection, // right-to-left lines read right-to-left (A099)
        assetRefsInMarkdown, // stored images: folded references, image paste/drop (A086)
        EditorState.allowMultipleSelections.of(true), // Find ▸ Find all selects every match
        // REQUIRED for multi-range selections to be VISIBLE: the native DOM
        // selection can only render one contiguous range, so without drawSelection
        // "Find all" / "Select all headings" appeared to select just the first
        // match. drawSelection paints every range CodeMirror holds.
        drawSelection(),
        cmPlaceholder("Start typing markdown..."),
        highlightSelectionMatches(),
        searchHighlightField,
        compositionEvents,
        themeExt,
        editableCompartment.current.of(roExt(readOnlyRef.current)),
        spellcheckCompartment.current.of(
          EditorView.contentAttributes.of({ spellcheck: String(spellcheckRef.current) })
        ),
        // A089: CodeMirror gives its content role="textbox" but no name, so a
        // screen reader could not tell the two panes apart. The description
        // documents the Tab capture that `indentWithTab` imposes.
        EditorView.contentAttributes.of({
          "aria-label": "Markdown source",
          "aria-description": "Tab indents. Press Escape, then Tab, to move focus out of the editor.",
        }),
        updateListener,
      ];
      const state = EditorState.create({
        doc: defaultValue || "",
        extensions: extensionsRef.current,
      });

      viewRef.current = new EditorView({ state, parent: containerRef.current });

      return () => {
        viewRef.current?.destroy();
        viewRef.current = null;
      };
    }, []); 

    // No theme reconfiguration needed on isDark change — cmTheme() uses
    // CSS variables that respond to the .dark class on <html> automatically.

    // Read-only mode: reconfigure the editability compartment when it changes.
    useEffect(() => {
      viewRef.current?.dispatch({ effects: editableCompartment.current.reconfigure(roExt(readOnly)) });
    }, [readOnly]);

    // Spellcheck: live-reconfigure the content attribute when the pref changes.
    useEffect(() => {
      viewRef.current?.dispatch({
        effects: spellcheckCompartment.current.reconfigure(
          EditorView.contentAttributes.of({ spellcheck: String(spellcheck) })
        ),
      });
    }, [spellcheck]);

    /**
     * Put a freshly `setState`-ed view back under the CURRENT preferences.
     *
     * `view.setState` rebuilds everything from the state it is handed, and the
     * two paths that use it — resetHistory (every cross-document hydration)
     * and restoreEditorState (the per-document history cache) — hand it
     * extensions whose compartment contents were captured at MOUNT or at
     * capture time. So a document switch silently reverted the pane to the
     * mount-time read-only flag: editable in a read-only session (the audit
     * watched such edits autosave), or still locked after read-only was turned
     * off. Reconfiguring from the refs makes the live value win every time.
     */
    const reapplyLiveConfig = (view: EditorView) => {
      view.dispatch({
        effects: [
          editableCompartment.current.reconfigure(roExt(readOnlyRef.current)),
          spellcheckCompartment.current.reconfigure(
            EditorView.contentAttributes.of({ spellcheck: String(spellcheckRef.current) })
          ),
        ],
      });
    };

    useImperativeHandle(ref, () => ({
      getValue: () => viewRef.current?.state.doc.toString() || "",

      isComposing: () => {
        const view = viewRef.current;
        if (!view?.composing) { composeStampRef.current = 0; return false; }
        const now = Date.now();
        if (!composeStampRef.current) composeStampRef.current = now;
        // A composition still flagged live but silent for this long is a stuck
        // flag, not an IME — believing it forever wedges the whole sync.
        return now - composeStampRef.current < COMPOSITION_STALL_MS;
      },

      // End a live IME / dictation composition by blurring the pane. Measured
      // in a real browser: blur dispatches `compositionend` SYNCHRONOUSLY and
      // the composed text lands in this pane's own document before blur()
      // returns. Document-LEAVING paths need that — they are about to replace
      // the editor's content, so a composition they merely wait for is a
      // composition whose text is destroyed (see useDocumentLifecycle's
      // endCompositions). A no-op when nothing is composing, so it never
      // steals focus from an ordinary edit.
      endComposition: () => {
        const view = viewRef.current;
        if (view?.composing) view.contentDOM.blur();
      },

      // Current immutable EditorState (for the per-doc history cache).
      getEditorState: () => viewRef.current?.state ?? null,

      // Restore a previously captured EditorState. Caller must have validated
      // the cached text matches the current md-pane content (history-cache.ts).
      //
      // No `suppressNextUpdate` here or in resetHistory: `view.setState` runs
      // no update listeners, so a flag armed before it was never consumed by
      // it — it leaked into the user's NEXT transaction and swallowed that
      // edit's onChange. The first edit after a document switch (a whole paste,
      // say) was then never synced, never marked dirty and never saved.
      restoreEditorState: (state: EditorState) => {
        const view = viewRef.current;
        if (!view || !state) return;
        view.setState(state);
        reapplyLiveConfig(view);
      },

      // Drop undo/redo history by rebuilding the state around the current doc.
      // Required after hydrating a DIFFERENT document: stale history entries
      // from the previous doc would otherwise be replayed into the new one.
      resetHistory: () => {
        const view = viewRef.current;
        if (!view) return;
        view.setState(
          EditorState.create({ doc: view.state.doc.toString(), extensions: extensionsRef.current })
        );
        reapplyLiveConfig(view);
      },

      setValue: (md: string) => {
        const view = viewRef.current;
        // No view: nothing was written. Report that rather than letting the
        // caller record `md` as this pane's content — the sync engine hashes
        // the return value, and a hash for text the pane does not hold would
        // make the next projection skip a real change.
        if (!view) return null;
        const current = view.state.doc.toString();
        if (current === md) return md;

        let prefixLen = 0;
        const minLen = Math.min(current.length, md.length);
        while (prefixLen < minLen && current[prefixLen] === md[prefixLen]) prefixLen++;

        let suffixLen = 0;
        const maxSuffix = minLen - prefixLen; 
        while (suffixLen < maxSuffix &&
               current[current.length - 1 - suffixLen] === md[md.length - 1 - suffixLen]) suffixLen++;

        const from = prefixLen;
        const to = current.length - suffixLen;
        const insertEnd = md.length - suffixLen;
        const insert = insertEnd > from ? md.slice(from, insertEnd) : "";

        if (from === to && insert === "") return md;

        // Set the suppress flag only once we're certain we'll dispatch — an
        // early return above with the flag already set would swallow the NEXT
        // real keystroke's onChange (a dropped edit).
        suppressNextUpdate.current = true;
        view.dispatch({
          changes: { from, to, insert },
          annotations: Transaction.addToHistory.of(false),
        });
        // CodeMirror normalises line endings on insert, so the pane does not
        // always settle on exactly `md` (CRLF input is the case that differs).
        // The length check is O(1) and proves it: equal lengths mean nothing was
        // rewritten, and only the rare unequal case pays for reading the rope.
        // The caller hashes this to decide whether the panes agree, so claiming
        // text the pane does not hold costs a redundant projection.
        return view.state.doc.length === md.length ? md : view.state.doc.toString();
      },

      getSelection: () => {
        const view = viewRef.current;
        if (!view) return { from: 0, to: 0, text: "" };
        const { from, to } = view.state.selection.main;
        return { from, to, text: view.state.sliceDoc(from, to) };
      },

      getCursorPos: () => viewRef.current?.state.selection.main.head || 0,

      focus: () => viewRef.current?.focus(),

      dispatch: (tr: Transaction) => viewRef.current?.dispatch(tr),

      getView: () => viewRef.current,

      getCurrentLine: () => {
        const view = viewRef.current;
        if (!view) return { text: "", from: 0, to: 0, number: 0 };
        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        return { text: line.text, from: line.from, to: line.to, number: line.number };
      },

      replaceRange: (from: number, to: number, text: string) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ changes: { from, to, insert: text } });
      },

      insertAtCursor: (text: string) => {
        const view = viewRef.current;
        if (!view) return;
        const pos = view.state.selection.main.head;
        view.dispatch({
          changes: { from: pos, to: pos, insert: text },
          selection: { anchor: pos + text.length },
        });
        view.focus(); // restore focus/caret after a toolbar-driven insert
      },

      wrapSelection: (before: string, after: string) => {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to);
        view.dispatch({
          changes: { from, to, insert: before + selected + after },
          selection: { anchor: from + before.length, head: to + before.length },
        });
      },

      setSearchHighlight: (spec: HighlightSpec) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ effects: setSearchHighlights.of(spec) });
      },

      clearSearchHighlight: () => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ effects: setSearchHighlights.of(null) });
      },
    }), []);

    return (
      <div
        ref={containerRef}
        className={className}
        style={{ ...style, height: "100%", overflow: "hidden" }}
        onKeyDown={onKeyDown}
      />
    );
  }
);