import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { selectMenuBody, type MenuPrimitives } from "./SelectMenuContent";
import { useUIStore } from "../store/uiStore";
import {
  Bold, CaseSensitive, Clipboard, Code, Copy, Eraser, Hash, Heading1, Heading2, Heading3, Highlighter,
  Image as ImageIcon, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2,
  Scissors, Sigma, Strikethrough, Table as TableIcon, TextSelect,
  Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

export interface EditorContextMenuApi {
  /** Run a formatting/insert command (same command strings as the toolbar). */
  dispatch: (cmd: string, val?: unknown) => void;
  /** Headings of the current document, for the "Link to heading" submenu. */
  getHeadings: () => { level: number; text: string }[];
  /** Insert a heading anchor link ([[#Heading]]) into the focused pane. */
  insertHeadingLink: (anchor: string) => void;
  /** Standard clipboard / selection actions on the focused pane. */
  clipboard: (action: "cut" | "copy" | "paste" | "selectAll") => void;
  /**
   * Ask for a value, then dispatch — the toolbar and the menu bar both do this
   * and the context menu did not: it dispatched `createLink` / `insertImage` /
   * `insertMathInline` / `insertMathBlock` with NO value, and the dispatcher
   * guards each of them on `if (value)`. Formula was a no-op in both panes;
   * link and image were no-ops in the rich pane.
   */
  promptInsert: (kind: "link" | "image" | "mathInline" | "mathBlock") => void;
}

/**
 * Right-click context menu for the editor panes. It reuses the existing command
 * dispatcher (so every action behaves exactly like its toolbar/menu-bar
 * counterpart) and adds a "Link to heading" submenu backed by the new heading
 * anchor links. Rendered as a wrapper around the editor so a right-click / long
 * press anywhere in the panes opens it at the pointer.
 */
// Primitive family for the shared Select ▸ … renderer (context-menu variant).
const CONTEXT_SELECT_PRIMS = {
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  Item: ContextMenuItem,
  Group: ContextMenuGroup,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
} as unknown as MenuPrimitives;

export function EditorContextMenu({ api, children }: { api: EditorContextMenuApi; children: ReactNode }) {
  const d = api.dispatch;
  const enabled = useUIStore((s) => s.contextMenuEnabled);
  // Admin toggle: when disabled, fall back to the browser's native menu — render
  // the same pane container without the custom ContextMenu wrapper.
  if (!enabled) return <div className="flex min-h-0 flex-1 flex-col">{children}</div>;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div className="flex min-h-0 flex-1 flex-col" />}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {/* 1 — History */}
        <ContextMenuItem onClick={() => d("undo")}><Undo2 /> Undo <ContextMenuShortcut>⌘Z</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onClick={() => d("redo")}><Redo2 /> Redo <ContextMenuShortcut>⌘⇧Z</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />

        {/* 2 — Clipboard */}
        <ContextMenuItem onClick={() => api.clipboard("cut")}><Scissors /> Cut <ContextMenuShortcut>⌘X</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onClick={() => api.clipboard("copy")}><Copy /> Copy <ContextMenuShortcut>⌘C</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuItem onClick={() => api.clipboard("paste")}><Clipboard /> Paste <ContextMenuShortcut>⌘V</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSeparator />

        {/* 3 — Selection: "Select all" sits with the structured "Select by type…" */}
        <ContextMenuItem onClick={() => api.clipboard("selectAll")}><TextSelect /> Select all <ContextMenuShortcut>⌘A</ContextMenuShortcut></ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><TextSelect /> Select by type…</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[70vh] overflow-y-auto">
            {selectMenuBody(CONTEXT_SELECT_PRIMS, d)}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />

        {/* 4 — Inline formatting (applies to the current selection), with Clear
            formatting kept in the SAME group as the other formatting actions. */}
        <ContextMenuItem onClick={() => d("bold")}><Bold /> Bold</ContextMenuItem>
        <ContextMenuItem onClick={() => d("italic")}><Italic /> Italic</ContextMenuItem>
        <ContextMenuItem onClick={() => d("underline")}><UnderlineIcon /> Underline</ContextMenuItem>
        <ContextMenuItem onClick={() => d("strikethrough")}><Strikethrough /> Strikethrough</ContextMenuItem>
        <ContextMenuItem onClick={() => d("code")}><Code /> Inline code</ContextMenuItem>
        <ContextMenuItem onClick={() => d("hiliteColor", "#fef08a")}><Highlighter /> Highlight</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><CaseSensitive /> Change case</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => d("changeCase", "upper")}>UPPERCASE</ContextMenuItem>
            <ContextMenuItem onClick={() => d("changeCase", "lower")}>lowercase</ContextMenuItem>
            <ContextMenuItem onClick={() => d("changeCase", "title")}>Title Case</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onClick={() => d("clearFormatting")}><Eraser /> Clear formatting</ContextMenuItem>
        <ContextMenuSeparator />

        {/* 5 — Block type + links */}
        <ContextMenuSub>
          <ContextMenuSubTrigger><Heading1 /> Turn into</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => d("heading", 0)}>Normal text</ContextMenuItem>
            <ContextMenuItem onClick={() => d("heading", 1)}><Heading1 /> Heading 1</ContextMenuItem>
            <ContextMenuItem onClick={() => d("heading", 2)}><Heading2 /> Heading 2</ContextMenuItem>
            <ContextMenuItem onClick={() => d("heading", 3)}><Heading3 /> Heading 3</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => d("bulletList")}><List /> Bulleted list</ContextMenuItem>
            <ContextMenuItem onClick={() => d("orderedList")}><ListOrdered /> Numbered list</ContextMenuItem>
            <ContextMenuItem onClick={() => d("blockquote")}><Quote /> Blockquote</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuItem onClick={() => api.promptInsert("link")}><Link2 /> Add link…</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger><Hash /> Link to heading</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-72 overflow-y-auto">
            {(() => {
              const headings = api.getHeadings();
              if (!headings.length) {
                return <ContextMenuItem disabled>No headings in this document</ContextMenuItem>;
              }
              return headings.map((h, i) => (
                <ContextMenuItem
                  key={`${h.text}-${i}`}
                  onClick={() => api.insertHeadingLink(h.text)}
                  style={{ paddingLeft: `${0.5 + (h.level - 1) * 0.6}rem` }}
                >
                  <span className="truncate">{h.text}</span>
                </ContextMenuItem>
              ));
            })()}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />

        {/* 6 — Insert block content */}
        <ContextMenuSub>
          <ContextMenuSubTrigger><TableIcon /> Insert</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem onClick={() => api.promptInsert("image")}><ImageIcon /> Image…</ContextMenuItem>
            <ContextMenuItem onClick={() => d("insertTable", { rows: 3, cols: 3, withHeaderRow: true })}><TableIcon /> Table (3×3)</ContextMenuItem>
            <ContextMenuItem onClick={() => d("codeBlock")}><Code /> Code block</ContextMenuItem>
            <ContextMenuItem onClick={() => api.promptInsert("mathInline")}><Sigma /> Inline formula…</ContextMenuItem>
            <ContextMenuItem onClick={() => api.promptInsert("mathBlock")}><Sigma /> Formula block…</ContextMenuItem>
            <ContextMenuItem onClick={() => d("insertMermaid")}>Diagram (Mermaid)</ContextMenuItem>
            <ContextMenuItem onClick={() => d("insertAbc")}>Music score (ABC)</ContextMenuItem>
            <ContextMenuItem onClick={() => d("horizontalRule")}><Minus /> Horizontal rule</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
}
