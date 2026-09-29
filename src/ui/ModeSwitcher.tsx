import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import { Columns, FileCode2 } from "lucide-react";
import { MODES } from "../constants";
import { useUIStore } from "../store/uiStore";
import { Icons } from "./Icons";

interface ModeSwitcherProps {
  mode: string;
  setMode: (mode: string) => void;
}

/**
 * ModeSwitcher - Production-grade segmented control.
 * Combines ToggleGroup logic with Button primitives for maximum visual differentiation.
 */
const modes = [
  { id: MODES.MD, icon: FileCode2, label: "Markdown", short: "MD" },
  { id: MODES.HTML, icon: Icons.HTML, label: "HTML Text", short: "HTML" },
  { id: MODES.SPLIT, icon: Columns, label: "Split View", short: "Split" },
];
export function ModeSwitcher({ mode, setMode }: ModeSwitcherProps) {
  // Read-only locks the view: the mode is fixed to whatever was imposed so a
  // shared read-only link shows exactly the intended view. Turn read-only off
  // (Settings / View menu) to switch views again.
  const readOnly = useUIStore((s) => s.readOnly);

  return <ButtonGroup>
    {modes.map(({ id, icon: Icon, short, label }) => {
      return (
        <Button data-slot="mode-switcher-button" key={id} variant={mode === id ? "default" : "outline"} onClick={() => setMode(id)} disabled={readOnly} title={readOnly ? "View locked in read-only mode" : `${label} (${short})`} aria-label={label} aria-pressed={mode === id} className="pointer-coarse:min-h-9 pointer-coarse:min-w-9">
          <Icon className="size-3.5" />
          <span className={cn("text-xs tracking-tight whitespace-nowrap hidden sm:inline-block", mode === id ? "inline-block" : "")}>{short}</span>
        </Button>
      );
    })}
  </ButtonGroup>;


}