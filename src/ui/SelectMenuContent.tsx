// Shared, data-driven "Select ▸ …" folder-structured submenu, rendered with
// whichever menu primitive family is passed in (Dropdown for the Edit tab,
// Context for the right-click menu). One source of truth for both.
//
// SELECTION-ONLY: every entry places a real editor selection (no copy/format/delete
// actions live here — those belong in the clipboard group / toolbar). "Current
// block" selects one range; the grouped type entries multi-select every instance
// in the Markdown pane.

import type { ComponentType, ReactNode } from "react";
import { SCOPE_GROUPS, SCOPE_TYPES } from "../formatting/select-scope";
import { t, type MessageKey } from "../i18n";

// The group names are ids (compared in code); this is what each is CALLED.
const GROUP_LABELS: Record<(typeof SCOPE_GROUPS)[number], MessageKey> = {
  Headings: "menu.selectGroupHeadings",
  "Paragraphs & lists": "menu.selectGroupParagraphsLists",
  Blocks: "menu.selectGroupBlocks",
  Inline: "menu.selectGroupInline",
};

export interface MenuPrimitives {
  Sub: ComponentType<{ children: ReactNode }>;
  SubTrigger: ComponentType<{ children: ReactNode; disabled?: boolean }>;
  SubContent: ComponentType<{ children: ReactNode; className?: string }>;
  Item: ComponentType<{ children: ReactNode; onClick?: () => void; disabled?: boolean }>;
  Group: ComponentType<{ children: ReactNode }>;
  Label: ComponentType<{ children: ReactNode; className?: string }>;
  Separator: ComponentType<Record<string, never>>;
}

/**
 * Render the body INSIDE the "Select" submenu — selection targets only. The caller
 * wraps it in its own Sub/SubTrigger/SubContent labelled "Select". "Select all"
 * (whole document) lives in the clipboard group, not here.
 */
export function selectMenuBody(p: MenuPrimitives, dispatch: (cmd: string, val?: unknown) => void): ReactNode {
  const { Item, Group, Label, Separator } = p;
  return (
    <>
      <Item onClick={() => dispatch("selectBlock")}>{t("menu.currentBlock")}</Item>
      {SCOPE_GROUPS.map((group) => {
        const types = SCOPE_TYPES.filter((s) => s.group === group);
        if (!types.length) return null;
        return (
          <Group key={group}>
            <Separator />
            <Label className="text-[11px] font-normal text-muted-foreground">{t(GROUP_LABELS[group])}</Label>
            {types.map((s) => (
              <Item key={s.id} onClick={() => dispatch("selectScope", { scope: s.id })}>
                {s.label}
              </Item>
            ))}
          </Group>
        );
      })}
    </>
  );
}
