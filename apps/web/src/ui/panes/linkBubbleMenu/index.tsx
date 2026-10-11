import { Editor } from "@tiptap/core";
import { BubbleMenu } from '@tiptap/react/menus';
import { ExternalLink, Link2Off, Pencil } from "lucide-react";
import { runBubbleCommand } from "../utils/bubble-menu-command";
import { useT } from "@/i18n";

export interface LinkBubbleMenuProps {
  editor: Editor | null;
  isDark: boolean;
  /** Ask for a URL through the app's styled dialog. See handleEdit. */
  onEditLink?: (currentUrl: string) => Promise<string | null>;
}

/**
 * LinkBubbleMenu — Floating menu that appears when the cursor is inside a link.
 * Redesigned with Tailwind CSS v4 and industry-standard UX.
 */
export function LinkBubbleMenu({ editor, onEditLink }: LinkBubbleMenuProps) {
  const t = useT();
  if (!editor) return null;

  const handleEdit = () => {
    if (!editor.isEditable) return;
    const currentUrl = String(editor.getAttributes("link")["href"] || "");
    // Not `window.prompt`: ⌘K was deliberately moved onto the app's styled
    // dialog, and Chrome blocks JS dialogs invoked from a cross-origin iframe —
    // which is exactly the shipped /embed.html, where this button did nothing
    // at all. `onEditLink` is supplied by the pane's owner, which has the
    // DialogApi; with no handler we fall back rather than silently no-op.
    const apply = (url: string | null) => {
      if (url === null) return;
      runBubbleCommand(editor, (ed) =>
        url === ""
          ? ed.chain().focus().unsetMark("link").run()
          : ed.chain().focus().extendMarkRange("link").setMark("link", { href: url }).run()
      );
    };
    if (onEditLink) { void onEditLink(currentUrl).then(apply); return; }
    apply(window.prompt(t("toolbar.editLinkUrlPrompt"), currentUrl));
  };

  const handleUnlink = () => {
    runBubbleCommand(editor, (ed) => ed.chain().focus().unsetMark("link").run());
  };

  return (
    <BubbleMenu
      editor={editor}
      // See TableBubbleMenu: our own shouldShow replaces TipTap's, which is
      // where the isEditable test lives.
      shouldShow={({ editor: ed }) => ed.isEditable && ed.isActive("link")}
      options={{
        placement: "bottom-start",
        offset: 8,
      }}
    >
      <div className="flex items-center gap-1.5 p-1.5 rounded-lg bg-popover border border-border shadow-xl animate-in fade-in-0 zoom-in-95 max-w-[400px]">
        {/* Link Preview Info */}
        <div className="flex items-center gap-2 px-2 py-1 max-w-[220px]">
          <ExternalLink className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-mono text-primary-strong truncate cursor-default">
            {editor.getAttributes("link")["href"] || t("toolbar.noUrl")}
          </span>
        </div>

        {/* Vertical Divider */}
        <div className="w-px h-4 bg-border mx-0.5 shrink-0" />

        {/* Action Buttons */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={handleEdit}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title={t("toolbar.editLinkUrl")}
          >
            <Pencil className="h-3 w-3" />
            <span>{t("common.edit")}</span>
          </button>

          <button
            onClick={handleUnlink}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-destructive hover:bg-destructive/10 transition-colors"
            title={t("toolbar.removeLink")}
          >
            <Link2Off className="h-3 w-3" />
            <span>{t("toolbar.unlink")}</span>
          </button>
        </div>
      </div>
    </BubbleMenu>
  );
}