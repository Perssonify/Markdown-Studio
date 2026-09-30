import { ChainedCommands, Editor, Extension } from "@tiptap/core";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { WikiLink as Link } from "../extensions/WikiLink";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Table } from "@tiptap/extension-table";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableRow } from "@tiptap/extension-table-row";
import { TextAlign } from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Underline } from "@tiptap/extension-underline";
import { Node as PMNode } from "@tiptap/pm/model";
import { undoDepth } from "@tiptap/pm/history";
import { EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, JSONContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { COMPOSITION_STALL_MS } from "../constants";
import type { HighlightSpec } from "../formatting/find-engine";
import { useUIStore } from "../store/uiStore";
import { useT } from "../i18n";
import { CSSProperties, forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { BackgroundColor } from "../extensions/BackgroundColor";
import { BidiAuto } from "../extensions/BidiAuto";
import { EmojiNode } from "../extensions/EmojiNode";
import { FrontmatterBlock } from "../extensions/FrontmatterBlock";
import { Callout } from "../extensions/Callout";
import { Details, Summary } from "../extensions/Details";
import { MathBlock, MathInline } from "../extensions/MathNodes";
import { SizedImage } from "../extensions/SizedImage";
import { TableCellAlign } from "../extensions/TableCellAlign";
import { ThemeImage } from "../extensions/ThemeImage";
import { UnresolvedWikiLinks } from "../extensions/UnresolvedWikiLinks";
import { ListKeymapNoTab } from "../extensions/ListKeymapNoTab";
import { AltGraphPassthrough } from "../extensions/AltGraphPassthrough";
import { CodeBlockWithCopy } from "./CodeBlockWithCopy";
import { LinkBubbleMenu } from "./LinkBubbleMenu";
import { TableBubbleMenu } from "./TableBubbleMenu";
import {
  HIGHLIGHT_STYLE,
  MAX_PREVIEW_WIDGETS,
  REPLACE_NEW_STYLE,
  REPLACE_OLD_STYLE,
  GROUP_STYLES as TP_GROUP_STYLES,
} from "./search-colors";

/**
 * Search highlights, drawn from the RANGES the Find panel computed — the same
 * matches it counts and navigates (see CodeMirrorPane's buildSearchHighlights,
 * its twin). This used to re-run the query with a hard-coded "gi" — ignoring
 * Match case and Whole word — locate literal terms by `toLowerCase().indexOf`
 * (misaligned after any "İ"), and run the user's regex on the main thread on
 * every document change.
 */
function buildSearchDecorations(doc: PMNode, spec: HighlightSpec): DecorationSet | null {
  const size = doc.content.size;
  const decorations: Decoration[] = [];
  let widgetCount = 0;
  for (const r of spec.ranges) {
    // Zero-length matches have nothing to paint; stale ranges are skipped.
    if (r.to <= r.from || r.from < 0 || r.to > size) continue;
    if (spec.replaceMode) {
      decorations.push(Decoration.inline(r.from, r.to, { style: REPLACE_OLD_STYLE, class: "replace-preview-old" }));
      if (r.preview != null && widgetCount < MAX_PREVIEW_WIDGETS) {
        const expanded = r.preview;
        decorations.push(Decoration.widget(r.to, () => {
          const span = document.createElement("span");
          span.textContent = expanded;
          span.setAttribute("style", REPLACE_NEW_STYLE);
          return span;
        }, { side: 1 }));
        widgetCount++;
      }
    } else {
      decorations.push(Decoration.inline(r.from, r.to, { style: HIGHLIGHT_STYLE, class: "search-highlight" }));
      r.groups?.forEach(([gFrom, gTo], g) => {
        if (g >= TP_GROUP_STYLES.length || gTo <= gFrom || gFrom < 0 || gTo > size) return;
        decorations.push(Decoration.inline(gFrom, gTo, {
          style: TP_GROUP_STYLES[g],
          class: `search-group search-group-${g + 1}`,
        }));
      });
    }
  }
  return decorations.length ? DecorationSet.create(doc, decorations) : null;
}

const searchHighlightKey = new PluginKey<DecorationSet | null>("searchHighlight");

/**
 * Search highlighting, held in PLUGIN STATE rather than recomputed in
 * `props.decorations`.
 *
 * `props.decorations(state)` runs on every transaction — including the ones that
 * change nothing but the selection (each caret move, each drag-select) — so with
 * Find open the editor walked the ENTIRE document and re-allocated a Decoration
 * per match just to move the cursor one character. The set changes only when
 * the Find panel sends new ranges; an edit in between MAPS it, and the panel
 * recomputes and resends once the document has changed.
 */
const SearchHighlightExtension = Extension.create({
  name: "searchHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet | null>({
        key: searchHighlightKey,
        state: {
          init: () => null,
          apply: (tr, prev) => {
            // setSearchHighlight/clearSearchHighlight dispatch this meta.
            const meta = tr.getMeta(searchHighlightKey) as { spec: HighlightSpec | null } | undefined;
            if (meta) return meta.spec ? buildSearchDecorations(tr.doc, meta.spec) : null;
            if (!prev) return null;
            return tr.docChanged ? prev.map(tr.mapping, tr.doc) : prev;
          },
        },
        props: {
          decorations(state) {
            return searchHighlightKey.getState(state) ?? null;
          },
        },
      }),
    ];
  },
});

export interface TiptapPaneProps {
  isDark: boolean;
  defaultValue?: string;
  /** Fires on every edit. It carries NO payload on purpose: the sync engine
   *  reads the pane content itself when it projects, and serializing the whole
   *  document on every keystroke just to hand over a value nobody read cost a
   *  full DOM serialization per keypress. */
  onChange?: () => void;
  /** A pasted HTML payload plus the modifier state that goes with it. The
   *  modifier does NOT come from the ClipboardEvent — that type carries none
   *  (see TiptapPane.handlePaste). */
  onPaste?: (html: string, mods?: { shiftKey?: boolean }) => boolean;
  /** Ask for a link URL through the app's styled dialog (see LinkBubbleMenu). */
  onEditLink?: (currentUrl: string) => Promise<string | null>;

  className?: string;
  style?: CSSProperties;
}

/**
 * Extended Interface to define commands injected by extensions
 */
export interface TiptapPaneHandle {
  getHTML: () => string;
  getText: () => string;
  getJSON: () => JSONContent | undefined;
  setHTML: (html: string) => void;
  focus: () => void;
  getEditor: () => Editor | null;
  chain: () => ChainedCommands;
  isActive: (name: string, attrs?: Record<string, unknown>) => boolean;
  getAttributes: (name: string) => Record<string, unknown>;
  insertTable: (opts: { rows: number; cols: number; withHeaderRow: boolean }) => void;
  addTableRowAfter: () => void;
  addTableRowBefore: () => void;
  deleteTableRow: () => void;
  addTableColumnAfter: () => void;
  addTableColumnBefore: () => void;
  deleteTableColumn: () => void;
  deleteTable: () => void;
  toggleHeaderRow: () => void;
  getSelectionText: () => string;
  /** True while an IME / voice-dictation composition is active in this pane.
   *  The bidirectional sync consults this so a cross-pane re-projection never
   *  dispatches into the editor mid-composition (which aborts the composition
   *  and drops the streamed text — e.g. Windows Voice dictation). */
  isComposing: () => boolean;
  /** Pull the browser's current DOM selection into ProseMirror's state.
   *
   *  Browsers fire `selectionchange` ASYNCHRONOUSLY, and ProseMirror only reads
   *  the DOM selection when it does. A command issued within a few milliseconds
   *  of a Shift+Arrow selection therefore runs against a stale, still-collapsed
   *  selection — ⌘B sets a stored mark at the caret instead of bolding the
   *  selected text, and that mark is dropped the moment the real selection
   *  arrives. ProseMirror's own keydown handler calls `forceFlush()` for this,
   *  but that only acts when a mutation flush was already scheduled. */
  syncSelectionFromDom: () => void;
  /** Draw the Find panel's matches (see buildSearchDecorations). */
  setSearchHighlight: (spec: HighlightSpec) => void;
  clearSearchHighlight: () => void;
  /**
   * Drop the undo/redo history by re-initialising plugin state around the
   * current document. MUST be called after hydrating a different document:
   * without it, ⌘Z after a doc switch undoes the hydration itself and brings
   * the PREVIOUS document's content back — which autosave would then persist
   * into the newly active document.
   */
  resetHistory: () => void;
  /** Current immutable EditorState (for the per-doc history cache) or null. */
  getEditorState: () => EditorState | null;
  /** Undo-stack depth of the current state (0 when unavailable). */
  getUndoDepth: () => number;
  /**
   * Restore a previously captured EditorState (per-doc history cache).
   * Callers MUST have validated that the state's doc matches the current
   * document content — see history-cache.ts takeForRestore.
   */
  restoreEditorState: (state: EditorState) => void;
}

const TiptapPane = forwardRef<TiptapPaneHandle, TiptapPaneProps>(
  ({ isDark, defaultValue, onChange, onPaste, onEditLink, className, style }, ref) => {
    const t = useT();
    const onChangeRef = useRef(onChange);
    // When this pane last produced input while composing (COMPOSITION_STALL_MS).
    const composeStampRef = useRef(0);
    useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
    const readOnly = useUIStore((s) => s.readOnly);
    const spellcheck = useUIStore((s) => s.spellcheck);

    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          link: false,
          underline: false,
          heading: { levels: [1, 2, 3, 4, 5, 6] },
          codeBlock: false, // Disable default code block
          listKeymap: false, // replaced by ListKeymapNoTab below (Tiptap 3.31 Tab change)
        }),
        ListKeymapNoTab,
        CodeBlockWithCopy, // Use our custom code block with copy button
        TaskList, TaskItem.configure({ nested: true }),
        Callout, Details, Summary,
        MathInline, MathBlock, EmojiNode, FrontmatterBlock,
        Underline, TextStyle, Color, BackgroundColor, FontFamily, Subscript, Superscript,
        Link.configure({ openOnClick: false, HTMLAttributes: { class: "perssonify-link" } }),
        ThemeImage,
        SizedImage,
        Placeholder.configure({ placeholder: t("panes.startTypingRichText") }),
        TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
        Table.configure({ resizable: false }),
        TableRow, TableCell, TableHeader, TableCellAlign,
        SearchHighlightExtension,
        BidiAuto, // dir="auto" per text block — view-only, not in the schema
        UnresolvedWikiLinks, // broken-link marking (a plugin: no schema change)
        AltGraphPassthrough, // AltGr types; it never triggers a Mod-Alt keymap
      ],
      content: defaultValue || "",
      editorProps: {
        attributes: {
          "data-md-preview": "",
          "data-theme": isDark ? "dark" : "light",
          spellcheck: String(spellcheck),
          // A089: a bare contenteditable has no role or name. Repeated in the
          // theme effect below, which REPLACES this object.
          role: "textbox", "aria-multiline": "true", "aria-label": t("panes.richText"),
        },
        // See CodeMirrorPane: the composition's own begin/end events own the
        // liveness stamp, so it can never be stale when the next one starts.
        handleDOMEvents: {
          compositionstart: () => { composeStampRef.current = Date.now(); return false; },
          compositionend: () => { composeStampRef.current = 0; return false; },
        },
        handlePaste: (view, event) => {
          const html = event.clipboardData?.getData("text/html");
          if (html && onPaste) {
            // `ClipboardEvent` does NOT inherit from UIEvent and has no
            // `shiftKey` — not on a synthetic one, not on the event a real
            // ⇧+paste delivers (measured). Reading `event.shiftKey` was always
            // `undefined`, so the documented "Shift inverts the styled-paste
            // preference for one paste" could never fire. ProseMirror tracks
            // the modifier itself and reads exactly this field for its own
            // plain-text-paste branch, so take it from there.
            const shiftKey = !!(view as unknown as { input?: { shiftKey?: boolean } })?.input?.shiftKey;
            return onPaste(html, { shiftKey });
          }
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        // Liveness stamp for isComposing() — see COMPOSITION_STALL_MS.
        if (ed?.view?.composing) composeStampRef.current = Date.now();
        onChangeRef.current?.();
      },
    });

    useEffect(() => {
      if (!editor) return;
      editor.setOptions({
        editorProps: {
          ...editor.options.editorProps,
          attributes: {
            "data-md-preview": "",
            "data-theme": isDark ? "dark" : "light",
            spellcheck: String(spellcheck),
            role: "textbox", "aria-multiline": "true", "aria-label": t("panes.richText"),
          },
        },
      });
    }, [isDark, editor, spellcheck, t]);

    // Read-only mode disables editing (node views already honor editor.isEditable).
    useEffect(() => {
      if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly);
    }, [editor, readOnly]);

    useImperativeHandle(ref, () => ({
      getEditorState: () => (editor && !editor.isDestroyed ? editor.state : null),
      getUndoDepth: () => {
        try {
          return editor && !editor.isDestroyed ? undoDepth(editor.state) : 0;
        } catch { return 0; }
      },
      restoreEditorState: (state: EditorState) => {
        if (!editor || editor.isDestroyed || !state) return;
        editor.view.updateState(state);
      },
      resetHistory: () => {
        if (!editor || editor.isDestroyed) return;
        const st = editor.state;
        // Re-create the EditorState around the CURRENT doc: plugin states
        // (including undo/redo history) re-initialise empty. See the handle
        // interface for why this is required after cross-document hydration.
        editor.view.updateState(EditorState.create({ doc: st.doc, plugins: st.plugins }));
      },
      getHTML: () => editor?.getHTML() || "",
      getText: () => editor?.getText() || "",
      getJSON: () => editor?.getJSON(),
      setHTML: (html) => {
        if (!editor || editor.isDestroyed) return;
        editor.commands.setContent(html, {
          emitUpdate: false,
          errorOnInvalidContent: false,
        });
      },
      focus: () => { editor?.commands.focus(); },
      getEditor: () => editor,
      chain: () => editor!.chain().focus(),
      isActive: (name, attrs) => editor?.isActive(name, attrs) || false,
      getAttributes: (name) => editor?.getAttributes(name) || {},
      
      // Using 'as ChainedCommands & Record<string, any>' inside the handle is the safest 
      // way to handle dynamic extension commands without global module augmentation.
      insertTable: (opts) => (editor!.chain().focus() as ChainedCommands & Record<string, any>).insertTable(opts).run(),
      addTableRowAfter: () => (editor!.chain().focus() as ChainedCommands & Record<string, any>).addRowAfter().run(),
      addTableRowBefore: () => (editor!.chain().focus() as ChainedCommands & Record<string, any>).addRowBefore().run(),
      deleteTableRow: () => (editor!.chain().focus() as ChainedCommands & Record<string, any>).deleteRow().run(),
      addTableColumnAfter: () => (editor!.chain().focus() as ChainedCommands & Record<string, any>).addColumnAfter().run(),
      addTableColumnBefore: () => (editor!.chain().focus() as ChainedCommands & Record<string, any>).addColumnBefore().run(),
      deleteTableColumn: () => (editor!.chain().focus() as ChainedCommands & Record<string, any>).deleteColumn().run(),
      deleteTable: () => (editor!.chain().focus() as ChainedCommands & Record<string, any>).deleteTable().run(),
      toggleHeaderRow: () => (editor!.chain().focus() as ChainedCommands & Record<string, any>).toggleHeaderRow().run(),

      getSelectionText: () => {
        if (!editor) return "";
        const { from, to } = editor.state.selection;
        return editor.state.doc.textBetween(from, to, " ");
      },

      isComposing: () => {
        if (!editor || editor.isDestroyed || !editor.view?.composing) {
          composeStampRef.current = 0;
          return false;
        }
        const now = Date.now();
        if (!composeStampRef.current) composeStampRef.current = now;
        // See CodeMirrorPane.isComposing: a flag stuck on forever wedges every
        // projection, so it expires once the composition stops producing input.
        return now - composeStampRef.current < COMPOSITION_STALL_MS;
      },

      // End a live composition by blurring — see CodeMirrorPane.endComposition
      // for why a document-leaving path must do this rather than wait.
      endComposition: () => {
        if (!editor || editor.isDestroyed) return;
        if (editor.view?.composing) editor.view.dom.blur();
      },
      syncSelectionFromDom: () => {
        if (!editor || editor.isDestroyed) return;
        const view = editor.view as unknown as { composing?: boolean; domObserver?: { flush?: () => void } };
        // Never mid-composition: an IME owns the DOM until it ends, and reading
        // it out from under one is the class of bug the composition guards in
        // the sync engine exist to prevent.
        if (!view || view.composing) return;
        view.domObserver?.flush?.();
      },

      setSearchHighlight: (spec) => {
        if (!editor || editor.isDestroyed) return;
        editor.view.dispatch(editor.state.tr.setMeta(searchHighlightKey, { spec }));
      },

      clearSearchHighlight: () => {
        if (!editor || editor.isDestroyed) return;
        editor.view.dispatch(editor.state.tr.setMeta(searchHighlightKey, { spec: null }));
      },
    }), [editor]);

    return (
      <div className={className} style={style} data-theme={isDark ? "dark" : "light"}>
        <EditorContent editor={editor} className="h-full tiptap-editor-content" />
        {editor && <LinkBubbleMenu editor={editor} isDark={isDark} onEditLink={onEditLink} />}
        {editor && <TableBubbleMenu editor={editor} isDark={isDark} />}
      </div>
    );
  }
);

export { TiptapPane };

