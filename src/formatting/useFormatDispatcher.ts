import { indentLess, indentMore, redo as cmRedo, undo as cmUndo } from "@codemirror/commands";
import { ChangeSpec, EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { RefObject, useCallback, useEffect, useRef } from "react";
import { MODES } from "../constants";

// Starter content for the "Insert" toolbar menu.
const MERMAID_SAMPLE = "graph TD;\n  A[Start] --> B{Decision};\n  B -->|Yes| C[Do it];\n  B -->|No| D[Skip];";
const ABC_SAMPLE = "X:1\nT:Ode to Joy\nM:4/4\nL:1/4\nK:C\nE E F G | G F E D | C C D E | E3/2 D/2 D2 |";
import { clearMdFormatting, isWrapped as _isWrapped, mdLinkDestination, mdWrap as _mdWrap, mdWrapBy } from "./md-format-utils";
import { mdImage, toImageInsert } from "./image-insert";
import {
  type CaseMode,
  headingsCaseCM,
  headingsCaseTiptap,
  transformCaseCM,
  transformCaseTiptap,
} from "./case-transform";
import { selectScopeCM, selectBlockRich } from "./select-scope";
import { useUIStore } from "../store/uiStore";
import {
  mdDeleteTable as _mdDeleteTable,
  mdAddColumnAfter,
  mdAddColumnBefore,
  mdAddRowAfter,
  mdAddRowBefore,
  mdDeleteColumn,
  mdDeleteRow,
} from "./md-table-ops";

interface CMRef {
  getValue: () => string;
  setValue: (val: string) => void;
  getView: () => EditorView | null;
  focus?: () => void;
  isComposing?: () => boolean;
  endComposition?: () => void;
  insertAtCursor: (text: string) => void;
  wrapSelection: (before: string, after: string) => void;
  getSelection: () => { text: string };
}

interface TiptapRef {
  getEditor: () => any;
  isActive: (name: string, attrs?: any) => boolean;
  getAttributes: (name: string) => any;
  getHTML: () => string;
  setHTML: (html: string) => void;
  /** See TiptapPaneHandle — optional so a partial ref in a test still type-checks. */
  syncSelectionFromDom?: () => void;
  isComposing?: () => boolean;
  endComposition?: () => void;
}

interface FormatDispatcherParams {
  cmRef: RefObject<CMRef | null>;
  tiptapRef: RefObject<TiptapRef | null>;
  mode: string;
  syncMdToHtml?: () => void;
  syncHtmlToMd?: () => void;
  scheduleAutosave?: () => void;
  onFormatsChange?: (formats: FormatState) => void;
}

interface FormatState {
  /** Which pane a command would act on right now. See queryState. */
  pane?: "md" | "html";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  codeBlock?: boolean;
  blockquote?: boolean;
  bulletList?: boolean;
  orderedList?: boolean;
  taskList?: boolean;
  heading?: number;
  subscript?: boolean;
  superscript?: boolean;
  link?: boolean;
  textAlign?: "left" | "center" | "right" | "justify";
  color?: string | null;
  highlight?: string | null;
  fontFamily?: string | null;
  table?: boolean;
}

/**
 * Line numbers touched by ANY range of the selection, ascending, each once.
 *
 * The markdown formatters used to read `selection.main` only, so on the
 * multi-range selections that Select ▸ All headings / list items and Find ▸
 * Find all exist to produce, they formatted the first match and silently
 * ignored every other one.
 */
export function selectedLineNumbers(state: EditorState): number[] {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return [...lines].sort((a, b) => a - b);
}

/**
 * Is every line the selection touches one where indentation carries meaning?
 *
 * List items (nesting) and lines inside a fenced code block (code) — yes.
 * A paragraph — no: four leading spaces makes it an indented code block, so
 * "Indent" would silently change what the block IS. The rich pane refuses the
 * same case, and the two panes have to agree about what a button does.
 */
export function mdIndentable(view: EditorView): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;

  // Count fence delimiters ABOVE the selection: an odd count means it starts
  // inside a fenced block, where indentation is part of the code.
  let fences = 0;
  for (let n = 1; n < first; n++) {
    if (/^\s{0,3}(```|~~~)/.test(state.doc.line(n).text)) fences++;
  }
  if (fences % 2 === 1) return true;

  for (let n = first; n <= last; n++) {
    const text = state.doc.line(n).text;
    if (!text.trim()) continue;                       // blank lines ride along
    if (/^\s*([-*+]|\d+[.)])\s/.test(text)) continue; // a list item
    if (/^\s{0,3}(```|~~~)/.test(text)) continue;      // a fence delimiter
    return false;
  }
  return true;
}

export function useFormatDispatcher({
  cmRef,
  tiptapRef,
  mode,
  syncMdToHtml,
  syncHtmlToMd,
  scheduleAutosave,
  onFormatsChange,
}: FormatDispatcherParams) {
  const lastFocusedPane = useRef<"md" | "html">("md");
  const rafId = useRef<number | null>(null);

  const setFocusedPane = useCallback((pane: "md" | "html") => {
    lastFocusedPane.current = pane;
  }, []);

  const getTargetPane = useCallback((): "md" | "html" => {
    if (mode === MODES.MD) return "md";
    if (mode === MODES.HTML) return "html";
    return lastFocusedPane.current;
  }, [mode]);

  function mdWrap(before: string, after: string) {
    const cm = cmRef.current;
    if (!cm) return;
    const view = cm.getView();
    if (!view) return;
    _mdWrap(view, before, after);
  }

  function mdPrefixLine(prefix: string) {
    const cm = cmRef.current;
    if (!cm) return;
    const view = cm.getView();
    if (!view) return;

    const changes:ChangeSpec[] = [];
    for (const i of selectedLineNumbers(view.state)) {
      const line = view.state.doc.line(i);
      if (line.text.startsWith(prefix)) {
        changes.push({ from: line.from, to: line.from + prefix.length, insert: "" });
      } else {
        changes.push({ from: line.from, to: line.from, insert: prefix });
      }
    }
    view.dispatch({ changes });
  }

  // Task-list toggle for the MD pane. Unlike bulletList/orderedList (which use the
  // literal-prefix `mdPrefixLine`), a task line can already carry `[ ]` OR `[x]`, and
  // the command should also UPGRADE an existing bullet — so `mdPrefixLine("- [ ] ")`
  // (a `startsWith` match) wrongly stacked markers (`- [ ] - [x] task`). Regex-based:
  //   `- [ ] x` / `- [x] x` → remove the task marker (back to plain text)
  //   `- x` (bullet)        → upgrade to `- [ ] x`
  //   `x` (plain)           → `- [ ] x`
  function mdToggleTask() {
    const cm = cmRef.current;
    if (!cm) return;
    const view = cm.getView();
    if (!view) return;

    const taskRe = /^(\s*)([-*+]) \[[ xX]\] /;
    const bulletRe = /^(\s*)([-*+]) /;

    const changes: ChangeSpec[] = [];
    for (const i of selectedLineNumbers(view.state)) {
      const line = view.state.doc.line(i);
      const t = line.text;
      const taskM = taskRe.exec(t);
      if (taskM) {
        // Remove the task marker, keep the leading indentation.
        changes.push({ from: line.from, to: line.from + taskM[0].length, insert: taskM[1] });
        continue;
      }
      const bulletM = bulletRe.exec(t);
      if (bulletM) {
        // Upgrade a bullet: insert "[ ] " right after the marker + space.
        const at = line.from + bulletM[0].length;
        changes.push({ from: at, to: at, insert: "[ ] " });
        continue;
      }
      // Plain line: add "- [ ] " after any leading whitespace.
      const indent = (/^\s*/.exec(t) || [""])[0];
      changes.push({ from: line.from + indent.length, to: line.from + indent.length, insert: "- [ ] " });
    }
    view.dispatch({ changes });
  }

  function mdSetHeading(level: number) {
    const cm = cmRef.current;
    if (!cm) return;
    const view = cm.getView();
    if (!view) return;
    
    // Each range's caret line, once. Only the PREFIX is rewritten, so the
    // selection over each heading's text survives the change instead of
    // collapsing — which is what lets Select ▸ All headings be followed by
    // another command.
    const { state } = view;
    const newPrefix = level > 0 ? "#".repeat(level) + " " : "";
    const seen = new Set<number>();
    const changes: ChangeSpec[] = [];
    for (const r of state.selection.ranges) {
      const line = state.doc.lineAt(r.head);
      if (seen.has(line.number)) continue;
      seen.add(line.number);
      const old = /^#{1,6}\s*/.exec(line.text)?.[0] ?? "";
      changes.push({ from: line.from, to: line.from + old.length, insert: newPrefix });
    }
    view.dispatch({ changes });
  }

  function mdInsertTable(rows: number, cols: number) {
    const cm = cmRef.current;
    if (!cm) return;
    
    const header = "| " + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(" | ") + " |";
    const sep = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
    const body = Array.from({ length: rows - 1 }, () =>
      "| " + Array.from({ length: cols }, () => "     ").join(" | ") + " |"
    ).join("\n");
    
    cm.insertAtCursor("\n" + header + "\n" + sep + "\n" + body + "\n");
  }

  // The URL the user typed into the Link prompt. It used to be dropped: every
  // caller prompts for it and passes it, but the markdown side always wrote a
  // literal "(url)" placeholder, so ⌘K in this pane never linked anything.
  function mdInsertLink(url?: string) {
    const cm = cmRef.current;
    if (!cm) return;
    const dest = url ? mdLinkDestination(url) : "url";
    const { text } = cm.getSelection();
    if (text) {
      cm.wrapSelection("[", `](${dest})`);
    } else {
      cm.insertAtCursor(`[link text](${dest})`);
    }
  }

  // Like mdInsertLink, this ignored the URL the prompt collected and wrote a
  // placeholder; it now writes the image that was asked for, alt text included.
  function mdInsertImage(value?: unknown) {
    const img = toImageInsert(value);
    cmRef.current?.insertAtCursor(img ? mdImage(img) : "![alt text](image-url)");
  }

  function mdInsertHr() {
    cmRef.current?.insertAtCursor("\n\n---\n\n");
  }

  function mdInsertCode() {
    const view = cmRef.current?.getView();
    if (!view) return;
    // Per range: a range that spans lines becomes a fenced block, one that
    // does not becomes inline code.
    mdWrapBy(view, (text) => (text.includes("\n") ? ["```\n", "\n```"] : ["`", "`"]));
  }

  function mdInsertBlockquote() {
    mdPrefixLine("> ");
  }

  function mdWrapInlineStyle(cssProp: string, cssVal: string) {
    const cm = cmRef.current;
    if (!cm) return;
    const view = cm.getView();
    if (!view) return;
    const { state } = view;

    // Every range, not just the main one (see selectedLineNumbers). The new
    // span is left SELECTED, so a second colour command on the same range
    // takes the merge branch below instead of nesting another span.
    view.dispatch(state.changeByRange((range) => {
      const { from, to } = range;
      const selectedText = state.sliceDoc(from, to);

      // Check whether the selection is already exactly one <span style="...">…</span>
      const outerSpanRe = /^<span\s+style="([^"]*)"[^>]*>([\s\S]*)<\/span>$/i;
      const outerMatch = selectedText.match(outerSpanRe);

      let newStyleStr: string;
      let innerText: string;

      if (outerMatch) {
        // Merge: update or insert the CSS property within the existing style string
        const existingStyle = outerMatch[1]!;
        innerText = outerMatch[2]!;
        const propEscaped = cssProp.replace(/-/g, "\\-");
        const propRe = new RegExp(`${propEscaped}\\s*:[^;]*(;|$)`, "i");
        if (propRe.test(existingStyle)) {
          newStyleStr = existingStyle.replace(propRe, `${cssProp}: ${cssVal};`).replace(/;\s*$/, "");
        } else {
          newStyleStr = `${existingStyle.replace(/;\s*$/, "")}; ${cssProp}: ${cssVal}`;
        }
      } else {
        innerText = selectedText;
        newStyleStr = `${cssProp}: ${cssVal}`;
      }

      const newText = `<span style="${newStyleStr}">${innerText}</span>`;
      return { changes: { from, to, insert: newText }, range: EditorSelection.range(from, from + newText.length) };
    }));
  }

  function dispatchToTiptap(command: string, value?: any) {
    const tp = tiptapRef.current;
    if (!tp) return;
    const editor = tp.getEditor();
    if (!editor) return;
    // Act on the selection the user can SEE. ProseMirror reads the DOM
    // selection when the browser fires `selectionchange`, which is
    // asynchronous, so a command issued immediately after a selection gesture
    // would otherwise run against the previous one. See the handle's comment.
    tp.syncSelectionFromDom?.();

    const cmd = editor.chain().focus();

    switch (command) {
      case "undo": cmd.undo().run(); break;
      case "redo": cmd.redo().run(); break;
      case "bold": cmd.toggleBold().run(); break;
      case "italic": cmd.toggleItalic().run(); break;
      case "underline": cmd.toggleUnderline().run(); break;
      case "strikethrough": cmd.toggleStrike().run(); break;
      case "subscript": cmd.toggleSubscript().run(); break;
      case "superscript": cmd.toggleSuperscript().run(); break;
      case "code": cmd.toggleCode().run(); break;
      case "codeBlock": cmd.toggleCodeBlock().run(); break;
      case "blockquote": cmd.toggleBlockquote().run(); break;
      case "bulletList": cmd.toggleBulletList().run(); break;
      case "orderedList": cmd.toggleOrderedList().run(); break;
      case "taskList": cmd.toggleTaskList().run(); break;
      case "horizontalRule": cmd.setHorizontalRule().run(); break;
      case "heading":
        if (value > 0) cmd.toggleHeading({ level: value }).run();
        else cmd.setParagraph().run();
        break;
      case "alignLeft": cmd.setTextAlign("left").run(); break;
      case "alignCenter": cmd.setTextAlign("center").run(); break;
      case "alignRight": cmd.setTextAlign("right").run(); break;
      case "alignJustify": cmd.setTextAlign("justify").run(); break;
      case "foreColor": cmd.setColor(value).run(); break;
      case "unsetColor": cmd.unsetColor().run(); break;
      case "hiliteColor": cmd.setBackgroundColor(value).run(); break;
      case "unsetHighlight": cmd.unsetBackgroundColor().run(); break;
      case "fontFamily": cmd.setFontFamily(value).run(); break;
      // Indent/outdent mean ONE thing in a markdown document: change a list
      // item's nesting depth. There is no paragraph indent to represent, so
      // outside a list these are correctly no-ops (see the markdown side, which
      // must agree — four leading spaces there is a CODE BLOCK, not an indent).
      //
      // The item type has to come from the SELECTION. `sinkListItem("listItem")`
      // was hardcoded, and a task item's node is `taskItem`, so indent did
      // nothing at all inside a task list — which TaskItem is configured to
      // nest (`{ nested: true }`).
      case "indent":
      case "outdent": {
        const item = editor.isActive("taskItem") ? "taskItem" : "listItem";
        if (command === "indent") cmd.sinkListItem(item).run();
        else cmd.liftListItem(item).run();
        break;
      }
      case "createLink": {
        // Callers (toolbar dialog + ⌘K handler) always supply the URL.
        if (value) cmd.setLink({ href: value }).run();
        break;
      }
      case "unlink": cmd.unsetLink().run(); break;
      case "insertImage": {
        // { src, alt } from the prompts, or a bare URL from the host API (A096).
        const img = toImageInsert(value);
        if (img) cmd.setImage({ src: img.src, alt: img.alt }).run();
        break;
      }
      case "insertCallout":
        cmd.wrapIn("callout", { type: value || "note" }).run();
        break;
      case "insertDetails":
        cmd.insertContent({
          type: "details",
          attrs: { open: true },
          content: [
            { type: "summary", content: [{ type: "text", text: "Summary" }] },
            { type: "paragraph", content: [{ type: "text", text: "Details" }] },
          ],
        }).run();
        break;
      case "insertMathInline":
        if (value) cmd.insertContent({ type: "mathInline", attrs: { latex: value } }).run();
        break;
      case "insertMathBlock":
        if (value) cmd.insertContent({ type: "mathBlock", attrs: { latex: value } }).run();
        break;
      case "insertMermaid":
        cmd.insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: MERMAID_SAMPLE }] }).run();
        break;
      case "insertAbc":
        cmd.insertContent({ type: "codeBlock", attrs: { language: "abc" }, content: [{ type: "text", text: ABC_SAMPLE }] }).run();
        break;
      case "insertTable":
        cmd.insertTable(value || { rows: 3, cols: 3, withHeaderRow: true }).run(); break;
      case "tableAddRow": cmd.addRowAfter().run(); break;
      case "tableAddRowBefore": cmd.addRowBefore().run(); break;
      case "tableDeleteRow": cmd.deleteRow().run(); break;
      case "tableAddCol": cmd.addColumnAfter().run(); break;
      case "tableAddColBefore": cmd.addColumnBefore().run(); break;
      case "tableDeleteCol": cmd.deleteColumn().run(); break;
      case "deleteTable": cmd.deleteTable().run(); break;
      case "toggleHeaderRow": cmd.toggleHeaderRow().run(); break;
      case "removeFormat":
        cmd.unsetAllMarks().clearNodes().run();
        break;
      case "clearAll":
        editor.commands.clearContent();
        break;
      case "selectAll": cmd.selectAll().run(); break;
      case "selectBlock": selectBlockRich(editor); break;
      case "clearFormatting": cmd.unsetAllMarks().run(); break;
      case "changeCase":
        transformCaseTiptap(editor, value as CaseMode, useUIStore.getState().caseContentOnly);
        break;
      case "headingsCase":
        headingsCaseTiptap(editor, value as CaseMode, useUIStore.getState().caseContentOnly);
        break;
      default:
        console.warn(`[FormatDispatcher] Unknown HTML command: ${command}`);
    }
  }

  /**
   * Remove one inline-style declaration from `<span style="…">` wrappers inside
   * the selection, dropping the span entirely when nothing is left. The colour
   * commands write those spans; without this their "clear" counterparts had
   * nothing to undo them with on the markdown side.
   */
  function mdUnwrapInlineStyle(prop: string) {
    const view = cmRef.current?.getView();
    if (!view) return;
    replaceEachRange(view, (text) => text.replace(
      /<span style="([^"]*)">([\s\S]*?)<\/span>/g,
      (whole, style: string, inner: string) => {
        const kept = style
          .split(";")
          .map((d) => d.trim())
          .filter((d) => d && d.split(":")[0]?.trim().toLowerCase() !== prop);
        if (!kept.length) return inner;
        // Another declaration survives, so the span stays — minus this one.
        return kept.join("; ") === style.trim() ? whole : `<span style="${kept.join("; ")}">${inner}</span>`;
      }
    ));
  }

  /** Rewrite the text of every NON-EMPTY range, leaving each rewritten range
   *  selected. A range whose text comes back unchanged is not touched, and if
   *  none changed nothing is dispatched (no empty undo step). */
  function replaceEachRange(view: EditorView, rewrite: (text: string) => string) {
    const { state } = view;
    let changed = false;
    const spec = state.changeByRange((range) => {
      if (range.empty) return { range };
      const text = state.sliceDoc(range.from, range.to);
      const next = rewrite(text);
      if (next === text) return { range };
      changed = true;
      return {
        changes: { from: range.from, to: range.to, insert: next },
        range: EditorSelection.range(range.from, range.from + next.length),
      };
    });
    if (changed) view.dispatch(spec);
  }

  function dispatchToMd(command: string, value?: any) {
    const cm = cmRef.current;
    const view = cm?.getView();
    
    switch (command) {
      case "undo": if (view) cmUndo(view); break;
      case "redo": if (view) cmRedo(view); break;
      case "bold": mdWrap("**", "**"); break;
      case "italic": mdWrap("*", "*"); break;
      case "underline": mdWrap("<u>", "</u>"); break;
      case "strikethrough": mdWrap("~~", "~~"); break;
      case "subscript": mdWrap("<sub>", "</sub>"); break;
      case "superscript": mdWrap("<sup>", "</sup>"); break;
      case "code": mdInsertCode(); break;
      case "codeBlock": mdWrap("```\n", "\n```"); break;
      case "blockquote": mdInsertBlockquote(); break;
      case "bulletList": mdPrefixLine("- "); break;
      case "orderedList": mdPrefixLine("1. "); break;
      case "taskList": mdToggleTask(); break;
      case "horizontalRule": mdInsertHr(); break;
      case "heading": mdSetHeading(value || 0); break;
      case "alignLeft": mdWrapInlineStyle("text-align", "left"); break;
      case "alignCenter": mdWrapInlineStyle("text-align", "center"); break;
      case "alignRight": mdWrapInlineStyle("text-align", "right"); break;
      // Its three siblings were here and it was not, so Format ▸ Justify fell
      // through to the unknown-command warning on the markdown side.
      case "alignJustify": mdWrapInlineStyle("text-align", "justify"); break;
      case "foreColor": mdWrapInlineStyle("color", value); break;
      // Unwraps the <span style="…"> the colour commands above write. These
      // were bare `break`s, so the toolbar's clear-colour and clear-highlight
      // buttons did nothing whenever the markdown pane was the target — and
      // exec() still toasted "Applied locally…" for a command that applied
      // nothing.
      case "unsetColor": mdUnwrapInlineStyle("color"); break;
      case "hiliteColor": mdWrapInlineStyle("background-color", value); break;
      case "unsetHighlight": mdUnwrapInlineStyle("background-color"); break; 
      case "fontFamily": mdWrapInlineStyle("font-family", value); break;
      case "createLink": mdInsertLink(typeof value === "string" ? value : undefined); break;
      case "insertImage": mdInsertImage(value); break;
      case "insertCallout": cmRef.current?.insertAtCursor(`\n> [!${String(value || "note").toUpperCase()}]\n> \n\n`); break;
      // Single contiguous HTML block (no internal blank lines, which would split
      // the marked HTML block) so it round-trips through the Details/Summary nodes.
      case "insertDetails": cmRef.current?.insertAtCursor(`\n<details>\n<summary>Summary</summary>\n<p>Details</p>\n</details>\n\n`); break;
      case "insertMathInline": if (value) cmRef.current?.insertAtCursor(`$${value}$`); break;
      case "insertMathBlock": if (value) cmRef.current?.insertAtCursor(`\n\n$$\n${value}\n$$\n\n`); break;
      case "insertMermaid": cmRef.current?.insertAtCursor(`\n\n\`\`\`mermaid\n${MERMAID_SAMPLE}\n\`\`\`\n\n`); break;
      case "insertAbc": cmRef.current?.insertAtCursor(`\n\n\`\`\`abc\n${ABC_SAMPLE}\n\`\`\`\n\n`); break;
      case "insertTable": mdInsertTable(value?.rows || 3, value?.cols || 3); break;
      case "tableAddRow": if (view) mdAddRowAfter(view); break;
      case "tableAddRowBefore": if (view) mdAddRowBefore(view); break;
      case "tableDeleteRow": if (view) mdDeleteRow(view); break;
      case "tableAddCol": if (view) mdAddColumnAfter(view); break;
      case "tableAddColBefore": if (view) mdAddColumnBefore(view); break;
      case "tableDeleteCol": if (view) mdDeleteColumn(view); break;
      case "deleteTable": if (view) _mdDeleteTable(view); break;
      // DELIBERATELY a no-op, and the toolbar hides the control when the
      // markdown pane is the target (see Toolbar). A GFM table is defined by its
      // delimiter row: remove it and the block stops being a table at all, so
      // "toggle the header" has no markdown meaning to implement.
      case "toggleHeaderRow": break; 
      // Indent / outdent are CodeMirror's own, so they respect the configured
      // unit and behave on a multi-line selection the way the editor does
      // everywhere else. Both used to reach the unknown-command warning, which
      // made the toolbar's two indent buttons and ⌘] / ⌘[ dead controls.
      //
      // But they are SCOPED to lines where indentation means indentation. In
      // markdown, four leading spaces on a paragraph is an indented CODE BLOCK:
      // measured, two clicks of Indent on a paragraph turned it into <pre> in
      // the rich pane. That is a silent change of block type from a button
      // labelled "Indent", and it made the two panes disagree — the rich side
      // correctly refuses to indent a paragraph, because there is nothing to
      // represent. List lines nest; fenced-code lines indent as code. Anything
      // else is left alone.
      case "indent":
      case "outdent": {
        if (!view) break;
        if (!mdIndentable(view)) break;
        if (command === "indent") indentMore(view);
        else indentLess(view);
        break;
      }
      // Edit ▸ Clear formatting and right-click ▸ Clear formatting dispatch this
      // name; the toolbar's eraser dispatches "removeFormat". They were the same
      // affordance with different outcomes — one worked, one warned.
      case "clearFormatting":
      case "removeFormat": {
        // Formatting only — never content. The old regex pass deleted images,
        // autolinks and every other tag, list bullets, the `*` in `5 * 3 * 2`
        // and the contents of code spans; see clearMdFormatting.
        if (view) replaceEachRange(view, clearMdFormatting);
        break;
      }
      case "selectAll":
        if (view) view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        break;
      case "selectBlock":
        if (view) {
          const st = view.state;
          const cur = st.doc.lineAt(st.selection.main.head);
          let a = cur.number, b = cur.number;
          while (a > 1 && st.doc.line(a - 1).text.trim() !== "") a--;
          while (b < st.doc.lines && st.doc.line(b + 1).text.trim() !== "") b++;
          view.dispatch({ selection: { anchor: st.doc.line(a).from, head: st.doc.line(b).to }, scrollIntoView: true });
          view.focus();
        }
        break;
      case "changeCase":
        if (view) transformCaseCM(view, value as CaseMode, useUIStore.getState().caseContentOnly);
        break;
      case "headingsCase":
        if (view) headingsCaseCM(view, value as CaseMode, useUIStore.getState().caseContentOnly);
        break;
      default:
        console.warn(`[FormatDispatcher] Unknown MD command: ${command}`);
    }
  }

  const dispatch = useCallback((command: string, value?: any) => {
    // A live IME / voice-dictation composition owns its pane's DOM, and every
    // branch below eventually dispatches into one of the panes. Measured with a
    // real composition: ⌘B while dictating into the markdown pane left the
    // streamed text DUPLICATED in that pane and the rich pane never converged.
    // ProseMirror already ignores keys near a composition, so the rich pane was
    // never affected — this makes the markdown pane behave the same way, by
    // ending the composition (which commits its text) before acting on it,
    // rather than silently dropping the command.
    if (cmRef.current?.isComposing?.() || tiptapRef.current?.isComposing?.()) {
      const rich = getTargetPane() === "html";
      cmRef.current?.endComposition?.();
      tiptapRef.current?.endComposition?.();
      // Ending a composition means blurring the pane; put focus back so the
      // command lands on a focused editor and the caret does not vanish.
      if (rich) tiptapRef.current?.getEditor?.()?.commands?.focus?.();
      else cmRef.current?.focus?.();
    }
    const readOnly = useUIStore.getState().readOnly;

    // Selection commands are non-mutating — always allowed (even read-only), and
    // routed before the read-only guard.
    if (command === "selectScope") {
      const view = cmRef.current?.getView?.();
      if (!view || !value?.scope) return;
      selectScopeCM(view, value.scope as string);
      // A scattered selection is a MARKDOWN-pane capability: CodeMirror supports
      // multiple ranges natively, ProseMirror has exactly one. Both panes stay
      // mounted (the hidden one is only `hidden`), so this used to place a real
      // multi-range selection into a pane the user could not see — ~14 enabled,
      // permanently inert menu entries in Rich mode. Bring the markdown pane
      // into view instead, so the command does what it says.
      const ui = useUIStore.getState();
      if (ui.mode === MODES.HTML && !ui.readOnly) ui.setMode(MODES.SPLIT);
      view.focus();
      return;
    }
    if (command === "selectAll" || command === "selectBlock") {
      if (getTargetPane() === "html") dispatchToTiptap(command);
      else dispatchToMd(command);
      return;
    }

    // Read-only mode: every remaining command mutates the document (format /
    // insert / table / case / undo-redo / clear), so block them all. Single
    // choke-point for toolbar, menu bar, keyboard shortcuts, and the right-click
    // context menu — native pane editability only stops typing.
    if (readOnly) return;
    const target = getTargetPane();

    if (target === "html") {
      dispatchToTiptap(command, value);
      syncHtmlToMd?.();
    } else {
      dispatchToMd(command, value);
      syncMdToHtml?.();
    }
    scheduleAutosave?.();
  }, [getTargetPane, syncMdToHtml, syncHtmlToMd, scheduleAutosave]);

  const queryState = useCallback((): FormatState => {
    const target = getTargetPane();
    // Published with the rest of the format state so the toolbar can hide
    // controls the TARGET pane cannot perform. Gating on `mode` alone was wrong
    // in split view: with the markdown pane focused the target is "md" while
    // the mode is "split", so rich-only buttons stayed visible and inert.
    const pane = target;

    if (target === "html") {
      const tp = tiptapRef.current;
      if (!tp || typeof tp.isActive !== "function") return { pane };
      
      return {
        bold: tp.isActive("bold"),
        pane,
        italic: tp.isActive("italic"),
        underline: tp.isActive("underline"),
        strike: tp.isActive("strike"),
        code: tp.isActive("code"),
        codeBlock: tp.isActive("codeBlock"),
        blockquote: tp.isActive("blockquote"),
        bulletList: tp.isActive("bulletList"),
        orderedList: tp.isActive("orderedList"),
        taskList: tp.isActive("taskList"),
        heading: [1, 2, 3, 4, 5, 6].find(l => tp.isActive("heading", { level: l })) || 0,
        subscript: tp.isActive("subscript"),
        superscript: tp.isActive("superscript"),
        link: tp.isActive("link"),
        textAlign: (tp.getAttributes("paragraph")?.textAlign || tp.getAttributes("heading")?.textAlign || "left") as "left" | "center" | "right" | "justify",
        color: tp.getAttributes("textStyle")?.color || null,
        highlight: tp.getAttributes("textStyle")?.backgroundColor || null,
        fontFamily: tp.getAttributes("textStyle")?.fontFamily || null,
        table: tp.isActive("table"),
      };
    }

    const cm = cmRef.current;
    if (!cm) return { pane };
    const view = cm.getView();
    if (!view) return { pane };

    const { from } = view.state.selection.main;
    const line = view.state.doc.lineAt(from);
    const text = line.text;
    const headingMatch = text.match(/^(#{1,6})\s/);

    return {
      pane,
      bold: _isWrapped(view, "**", "**"),
      italic: _isWrapped(view, "*", "*") || _isWrapped(view, "_", "_"),
      underline: _isWrapped(view, "<u>", "</u>"),
      strike: _isWrapped(view, "~~", "~~"),
      code: _isWrapped(view, "`", "`"),
      codeBlock: text.startsWith("```"),
      blockquote: text.startsWith("> "),
      taskList: /^\s*[-*+]\s\[[ xX]?\]\s/.test(text),
      bulletList: /^\s*[-*+]\s/.test(text) && !/^\s*[-*+]\s\[[ xX]?\]\s/.test(text),
      orderedList: /^\s*\d+\.\s/.test(text),
      heading: headingMatch ? headingMatch[1]?.length ?? 0 : 0,
      subscript: _isWrapped(view, "<sub>", "</sub>"),
      superscript: _isWrapped(view, "<sup>", "</sup>"),
      link: false,
      textAlign: "left",
      color: null,
      highlight: null,
      fontFamily: null,
      table: /^\|.+\|/.test(text),
    };
  }, [getTargetPane, cmRef, tiptapRef]);

  /** Publish the toolbar's formatting state.
   *
   *  This used to ALSO write a local `useState` in this hook. Nothing read it —
   *  PerssonifyEditor destructures this hook without `activeFormats`, and the
   *  toolbar reads `editorStore.activeFormats` instead — but because the hook
   *  runs inside PerssonifyEditor, that setState re-rendered the whole editor
   *  shell on every `keyup` AND every `selectionchange`, i.e. on every keystroke
   *  and every caret move, for a value nobody consumed. `onFormatsChange` is the
   *  real (and only) delivery path. */
  const publishFormats = useCallback(() => {
    onFormatsChange?.(queryState());
  }, [queryState, onFormatsChange]);

  const updateFormats = useCallback((forceImmediate?: boolean | Event) => {
    if (forceImmediate === true) {
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
      publishFormats();
      return;
    }

    if (rafId.current) return;

    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      publishFormats();
    });
  }, [publishFormats]);

  useEffect(() => {
    document.addEventListener("selectionchange", updateFormats);
    document.addEventListener("keyup", updateFormats);
    
    return () => {
      document.removeEventListener("selectionchange", updateFormats);
      document.removeEventListener("keyup", updateFormats);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, [updateFormats]);

  return {
    dispatch,
    queryState,
    updateFormats,
    setFocusedPane,
  };
}