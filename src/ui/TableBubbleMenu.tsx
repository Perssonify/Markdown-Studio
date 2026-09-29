import { Editor } from "@tiptap/core";
import '@tiptap/extension-table';
import { BubbleMenu } from "@tiptap/react/menus";
import {
    ArrowDownToLine,
    ArrowLeftToLine,
    ArrowRightToLine,
    ArrowUpToLine,
    Columns,
    PlaySquare,
    Rows,
    Trash2
} from "lucide-react";
import React from "react";
import { runBubbleCommand } from "./bubble-menu-command";
export interface TableBubbleMenuProps {
  editor: Editor | null;
  isDark: boolean;
}

interface TblBtnProps {
  icon: React.ElementType;
  label: string;
  title: string;
  onClick: () => void;
  danger?: boolean;
}

/**
 * TblBtn — Unified sub-component for table operations.
 * Designed with a compact footprint and Apple-style semantic coloring.
 */
function TblBtn({ icon: Icon, label, title, onClick, danger }: TblBtnProps) {
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
      onMouseDown={(e) => e.preventDefault()}
      title={title}
      className={`
        flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition-all duration-200
        focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95
        ${danger 
          ? "text-destructive hover:bg-destructive/10" 
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        }
      `}
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="hidden sm:inline-block">{label}</span>
    </button>
  );
}

/**
 * Vertical divider for grouping actions.
 */
function TblSep() {
  return <div className="w-px h-4 bg-border mx-1 shrink-0" />;
}

/**
 * TableBubbleMenu — Floating toolbar providing granular control over table structures.
 * Redesigned with Tailwind CSS v4, Lucide icons, and high-density layouts.
 */
export function TableBubbleMenu({ editor }: TableBubbleMenuProps) {
  if (!editor) return null;

  return (
    <BubbleMenu
      editor={editor}
      // `isEditable` is part of TipTap's DEFAULT shouldShow; supplying our own
      // replaced it, so the menu appeared — and worked — in read-only mode.
      shouldShow={({ editor: ed }) => ed.isEditable && ed.isActive("table") && !ed.isActive("link")}
      options={{
        placement: "top",
        offset: 12,
      }}
    >
      <div className="flex items-center gap-0.5 p-1.5 rounded-lg bg-popover border border-border shadow-xl animate-in fade-in-0 zoom-in-95 backdrop-blur-md">
        
        {/* Row Operations */}
        <div className="flex items-center">
          <TblBtn 
            icon={ArrowUpToLine} 
            label="Row Above" 
            title="Insert row before" 
            onClick={() => runBubbleCommand(editor, (ed) => ed.chain().focus().addRowBefore().run())} 
          />
          <TblBtn 
            icon={ArrowDownToLine} 
            label="Row Below" 
            title="Insert row after" 
            onClick={() => runBubbleCommand(editor, (ed) => ed.chain().focus().addRowAfter().run())} 
          />
          <TblBtn 
            icon={Rows} 
            label="Del Row" 
            title="Delete current row" 
            onClick={() => runBubbleCommand(editor, (ed) => ed.chain().focus().deleteRow().run())} 
          />
        </div>

        <TblSep />

        {/* Column Operations */}
        <div className="flex items-center">
          <TblBtn 
            icon={ArrowLeftToLine} 
            label="Col Left" 
            title="Insert column before" 
            onClick={() => runBubbleCommand(editor, (ed) => ed.chain().focus().addColumnBefore().run())} 
          />
          <TblBtn 
            icon={ArrowRightToLine} 
            label="Col Right" 
            title="Insert column after" 
            onClick={() => runBubbleCommand(editor, (ed) => ed.chain().focus().addColumnAfter().run())} 
          />
          <TblBtn 
            icon={Columns} 
            label="Del Col" 
            title="Delete current column" 
            onClick={() => runBubbleCommand(editor, (ed) => ed.chain().focus().deleteColumn().run())} 
          />
        </div>

        <TblSep />

        {/* Table Management */}
        <div className="flex items-center">
          <TblBtn 
            icon={PlaySquare} 
            label="Header" 
            title="Toggle header row" 
            onClick={() => runBubbleCommand(editor, (ed) => ed.chain().focus().toggleHeaderRow().run())} 
          />
          <TblBtn 
            icon={Trash2} 
            label="Delete" 
            title="Remove entire table" 
            danger 
            onClick={() => runBubbleCommand(editor, (ed) => ed.chain().focus().deleteTable().run())} 
          />
        </div>
      </div>
    </BubbleMenu>
  );
}