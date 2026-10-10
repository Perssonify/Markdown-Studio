import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { Columns, FileCode2 } from "lucide-react";
import { MODES } from "../constants";
import { useUIStore } from "../store/preferences/uiStore";
import { Icons } from "./Icons";
import { t, useT } from "../i18n";

interface ModeSwitcherProps {
  mode: string;
  setMode: (mode: string) => void;
}

/**
 * ModeSwitcher - Production-grade segmented control.
 * Combines ToggleGroup logic with Button primitives for maximum visual differentiation.
 */
const modes = [
  { id: MODES.MD, icon: FileCode2, get label() { return t("toolbar.modeMarkdown"); }, get short() { return t("toolbar.modeMarkdownShort"); } },
  // "Rich text", the name the status bar and Settings already use for this mode.
  { id: MODES.HTML, icon: Icons.HTML, get label() { return t("toolbar.modeRichText"); }, get short() { return t("toolbar.modeRichTextShort"); } },
  { id: MODES.SPLIT, icon: Columns, get label() { return t("toolbar.modeSplitView"); }, get short() { return t("toolbar.modeSplitViewShort"); } },
];

/**
 * A096 / WCAG 2.5.3 (label in name). The buttons SHOW "MD" / "HTML" / "Split"
 * but were NAMED "Markdown" / "HTML Text" / "Split View" — a speech-input user
 * saying "click MD" matched nothing. The name must contain the visible text;
 * the long form rides along after it.
 */
export function modeAccessibleName(short: string, label: string): string {
  return label.toLowerCase().includes(short.toLowerCase()) ? label : `${short} (${label})`;
}
export function ModeSwitcher({ mode, setMode }: ModeSwitcherProps) {
  const t = useT();
  // Read-only locks the view: the mode is fixed to whatever was imposed so a
  // shared read-only link shows exactly the intended view. Turn read-only off
  // (Settings / View menu) to switch views again.
  const readOnly = useUIStore((s) => s.readOnly);

  return <ButtonGroup>
    {modes.map(({ id, icon: Icon, short, label }) => {
      return (
        <Button data-slot="mode-switcher-button" key={id} variant={mode === id ? "default" : "outline"} onClick={() => setMode(id)} disabled={readOnly} title={readOnly ? t("toolbar.viewLockedInReadOnly") : t("toolbar.modeTitle", { label, short })} aria-label={modeAccessibleName(short, label)} aria-pressed={mode === id} className="pointer-coarse:min-h-9 pointer-coarse:min-w-9">
          <Icon className="size-3.5" />
          <span className={cn("text-xs tracking-tight whitespace-nowrap hidden sm:inline-block", mode === id ? "inline-block" : "")}>{short}</span>
        </Button>
      );
    })}
  </ButtonGroup>;


}