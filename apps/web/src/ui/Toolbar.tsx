import { displayKeys } from "../data/shortcuts";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SaveStatus } from "@/store/documents/documentStore";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown, ChevronUp,
  Highlighter,
  Image,
  Indent,
  Italic,
  Layout,
  Link,
  List, ListOrdered, ListTodo,
  Loader2,
  LucideIcon,
  Code,
  MinusSquare,
  Music,
  Outdent,
  Pin, PinOff, Plus, PlusSquare,
  Sigma,
  Workflow,
  Redo2,
  RemoveFormatting,
  Save,
  Search,
  Strikethrough,
  Subscript,
  Superscript,
  TableIcon,
  Trash2,
  Type,
  Underline,
  Undo2,
  X
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { TOOLBAR_COMPACT_BP } from '../constants';
import { useDialog } from "./DialogProvider";
import { useEditorStore } from '../store/editor/editorStore';
import { useUIStore } from '../store/preferences/uiStore';
import { TableGridPicker } from './TableGridPicker';
import { Icons } from "./Icons";
import { useRovingFocus } from "./use-roving-focus";
import { type ImageInsert, promptImage } from "../formatting/image-insert";
import { t, useT } from "../i18n";

/**
 * Arrow-key order is VISUAL order. Save floats right, so it comes FIRST in the
 * DOM (the float needs that) but sits LAST on screen; walking the DOM would
 * put it between nothing and "Search".
 */
function rightControlsLast(items: HTMLElement[]): HTMLElement[] {
  const right = items.filter((el) => el.closest("#toolbar-right-controls"));
  return right.length ? [...items.filter((el) => !right.includes(el)), ...right] : items;
}

// --- Types ---

export interface ActiveFormats {
  /** Which pane a command would act on right now — NOT the same as `mode`: in
   *  split view the target follows focus. Controls that only one pane can
   *  perform gate on this. */
  pane?: "md" | "html";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  bulletList?: boolean;
  orderedList?: boolean;
  taskList?: boolean;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  heading?: number;
  blockquote?: boolean;
  fontFamily?: string | null;
  color?: string | null;
  highlight?: string | null;
  table?: boolean;
}

export interface EditorToolbarProps {
  toast: { show: (msg: string, type: "info" | "success" | "error" | "warning") => void };
  dispatch: (cmd: string, val?: string | number | { rows: number; cols: number; withHeaderRow: boolean } | ImageInsert) => void;
  updateFormats: (forceImmediate?: boolean) => void;
  setFocusedPane: (pane: "md" | "html") => void;
  showFindReplace?: boolean;
  toggleFindReplace?: () => void;
  saveStatus: SaveStatus;
  onSave: () => void;
  /** Current view mode; used to hide rich-only controls in markdown view. */
  mode?: string;
}

interface TbBtnProps {
  icon: LucideIcon | React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  /**
   * Extra scope shown in the hover tooltip only. The accessible name stays
   * `title` — a screen reader announcing a sentence per button is worse than a
   * short one — but a button whose scope is narrower than its verb ("Indent"
   * nests a list item; it cannot indent a paragraph, because Markdown has no
   * such thing) should say so where a confused user will look.
   *
   * Consequence for tests and probes: select these buttons by `aria-label`, not
   * by `title` — the title now carries the hint and will change as the copy does.
   */
  hint?: string;
  active?: boolean;
  onClick: () => void;
  className?: string;
}

interface TbColorProps {
  value: string;
  onChange: (color: string) => void;
  title: string;
  isHighlight?: boolean;
  onClear?: () => void;
}


const blockOptions = [
  { value: "p", get label() { return t("toolbar.paragraph"); } },
  { value: "h1", get label() { return t("toolbar.heading", { level: 1 }); } },
  { value: "h2", get label() { return t("toolbar.heading", { level: 2 }); } },
  { value: "h3", get label() { return t("toolbar.heading", { level: 3 }); } },
  { value: "h4", get label() { return t("toolbar.heading", { level: 4 }); } },
  { value: "h5", get label() { return t("toolbar.heading", { level: 5 }); } },
  { value: "h6", get label() { return t("toolbar.heading", { level: 6 }); } },
  { value: "blockquote", get label() { return t("toolbar.quote"); } },
];

const fontOptions = [
  { value: "Arial", label: "Arial" },
  { value: "Inter", label: "Inter" },
  { value: "Georgia", label: "Georgia" },
  { value: "Courier New", get label() { return t("toolbar.fontMono"); } },
];

/**
 * The generated `default_soft` variant colours its glyph `text-primary` — the
 * bright fill, 1.7:1 on its own 10% tint in amber, so an ACTIVE format button's
 * icon (the only thing saying "bold is on") failed WCAG 1.4.11's 3:1 (A092).
 * The primitive is generated and not hand-edited; `cn` (tailwind-merge) lets a
 * className override the variant's colour classes, including the dark/hover
 * ones, so this is applied wherever the variant is.
 */
const SOFT_ACTIVE_INK = "text-primary-strong dark:text-primary-strong hover:dark:text-primary-strong";

function TbBtn({ icon: Icon, title, hint, active, onClick, className = "size-8" }: TbBtnProps) {
  const t = useT();
  return (
    <Button
      variant={active ? "default_soft" : "outline"}
      size="sm"
      // Preserve the editor selection on pointer press (don't blur the editor)…
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      // …but run the command on click, which ALSO fires on keyboard Enter/Space —
      // the previous onMouseDown-only wiring made every toolbar button unusable
      // by keyboard/assistive-tech users.
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      aria-label={title}
      aria-pressed={active}
      title={hint ? t("toolbar.titleWithHint", { title, hint }) : title}
      className={cn(className, active && SOFT_ACTIVE_INK)}
    >
      <Icon />
    </Button>
  );
}

/**
 * Vertical section divider between control groups. A shadcn `Separator`, so the
 * row is shadcn throughout. It carries NO horizontal margin of its own: the
 * flow container gives every direct child the same `mr-2`, so the gap is
 * symmetric on both sides. The old hand-rolled `w-px mx-0.5` div set a 2px
 * margin that overrode that `mr-2`, so a divider hugged the control after it
 * (2px) while sitting ~10px from the one before — the uneven spacing in the row.
 * `self-stretch` (the Separator default) does nothing in this inline-flow
 * context, so the height is explicit and sized to sit inside the 32px controls.
 */
function Divider() {
  return <Separator orientation="vertical" className="h-5 self-center" />;
}

/**
 * Resolve any CSS color (including `var(--token)`, `hsl(...)`, `rgb(...)`) to a
 * `#rrggbb` hex string that a native `<input type="color">` can display.
 * Falls back to `#000000` outside the browser or on unparseable input.
 */
function resolveToHex(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  if (typeof document === "undefined") return "#000000";
  let v = value.trim();
  const varMatch = v.match(/^var\((--[^,)]+)/);
  if (varMatch) {
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(varMatch[1]!)
      .trim();
    if (resolved) v = resolved;
  }
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#000000";
      ctx.fillStyle = v;
      const out = ctx.fillStyle;
      if (/^#[0-9a-fA-F]{6}$/.test(out)) return out;
    }
  } catch {
    /* ignore — fall through to default */
  }
  return "#000000";
}

/** Preset swatches. Text colors are saturated inks; highlight colors are the
 *  light shades a highlighter would use (kept legible by the dark-ink rule in
 *  styles.css / the preview CSS). */
const TEXT_SWATCHES = [
  "#e11d48", "#ea580c", "#ca8a04", "#16a34a",
  "#0891b2", "#2563eb", "#7c3aed", "#111827",
];
const HIGHLIGHT_SWATCHES = [
  "#fde68a", "#fecaca", "#bbf7d0", "#bfdbfe",
  "#ddd6fe", "#fbcfe8", "#a7f3d0", "#fef08a",
];

/** Pick a legible check-mark ink (black or white) for a given swatch color, so
 *  the "selected" check stays visible on both light and dark swatches. */
function readableInk(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return "#111827";
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? "#111827" : "#ffffff";
}

/**
 * Color / highlight control. Presents a popover of preset swatches plus a native
 * custom picker. Applying a color happens on click and is reflected two ways so
 * the user can SEE it worked: the active swatch gets a check ring, and a live
 * sample line renders the current selection. `value` reflects the editor's real
 * active format, so the checked swatch is genuine confirmation, not local state.
 */
function TbColor({ value, onChange, title, isHighlight = false, onClear }: TbColorProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const swatches = isHighlight ? HIGHLIGHT_SWATCHES : TEXT_SWATCHES;
  const activeHex = value ? resolveToHex(value) : "";
  const hasColor = !!value;

  const apply = (color: string) => {
    onChange(color);
    setOpen(false);
  };

  return (
    <span className="group/color relative inline-flex">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="relative h-8 w-12 justify-center gap-1 px-2" title={title} aria-label={title} />
          }
        >
          {isHighlight ? <Highlighter className="h-3.5 w-3.5" /> : <Type className="h-3.5 w-3.5" />}
          {/* The current colour, as a bar under the glyph — sits clear of the icon,
              so the button reads as "this tool, set to this colour". */}
          <div
            className="pointer-events-none absolute bottom-0.5 left-1.5 right-1.5 h-[3px] rounded-full"
            style={{ backgroundColor: hasColor ? value : "transparent", outline: hasColor ? "none" : "1px dashed var(--border)" }}
          />
          <ChevronDown className="h-3 w-3 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52 p-2">
          <div className="mb-2 px-0.5 text-[11px] font-medium text-muted-foreground">
            {title}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {swatches.map((c) => {
              const active = activeHex && resolveToHex(c) === activeHex;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => apply(c)}
                  title={c}
                  aria-label={isHighlight ? t("toolbar.highlightColorSwatch", { color: c }) : t("toolbar.textColorSwatch", { color: c })}
                  aria-pressed={!!active}
                  className={cn(
                    "relative flex h-8 items-center justify-center rounded-md border transition-transform hover:scale-105",
                    active ? "border-primary ring-2 ring-primary/40" : "border-border"
                  )}
                  style={{ backgroundColor: c }}
                >
                  {active && (
                    <Check className="h-4 w-4" style={{ color: readableInk(c) }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* Live sample so the user can see the effect before/after applying. */}
          <div className="mt-2 rounded-md border border-border bg-background px-2 py-1.5 text-center text-sm">
            {isHighlight ? (
              <span style={{ backgroundColor: hasColor ? value : "transparent", color: hasColor ? "#1c1917" : "inherit", padding: "0.05em 0.2em", borderRadius: 3 }}>
                {t("toolbar.highlightedText")}
              </span>
            ) : (
              <span style={{ color: hasColor ? value : "inherit" }}>{t("toolbar.sampleText")}</span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-1.5">
            <label className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent">
              <Plus className="h-3.5 w-3.5" />
              {t("toolbar.custom")}
              <input
                type="color"
                value={activeHex || "#000000"}
                onChange={(e) => apply(e.target.value)}
                className="absolute h-0 w-0 opacity-0"
              />
            </label>
            {onClear && (
              <button
                type="button"
                onClick={() => { onClear(); setOpen(false); }}
                disabled={!hasColor}
                className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-destructive hover:text-destructive-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                title={isHighlight ? t("toolbar.clearHighlight") : t("toolbar.clearTextColor")}
              >
                <X className="h-3.5 w-3.5" />
                {t("common.clear")}
              </button>
            )}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}




// --- Main Component ---

function EditorToolbarComponent({ toast, dispatch, updateFormats, showFindReplace, toggleFindReplace, saveStatus, onSave, mode }: EditorToolbarProps) {
  const t = useT();
  const st = useEditorStore((s) => s.activeFormats);
  const syncMode = useUIStore((s) => s.syncMode);
  // "full" (storage quota reached, A086) is terminal for AUTOSAVE, but a manual
  // save is exactly how a user retries after freeing space. "conflict" and
  // "blocked" stay disabled: saving them again would only be refused again.
  const isDirty = saveStatus === "editing" || saveStatus === "error" || saveStatus === "full";
  const [isCompact, setIsCompact] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const { prompt, equation } = useDialog();

  // A094: one tab stop for the whole bar (WAI-ARIA toolbar pattern) instead of
  // ~40 — the document used to be forty Tab presses away.
  useRovingFocus(rootRef, { orderItems: rightControlsLast });

  // Compact is decided by the toolbar's OWN width, not the window's: the full
  // control set needs ~TOOLBAR_COMPACT_BP px and used to wrap into a ragged,
  // mostly empty second row across the whole laptop range. Below the threshold
  // the essentials stay on one line and the rest sits behind the expand chevron.
  //
  // This used to say "with the sidebar open a 1280px window leaves ~900px
  // here", which stopped being true at the WorkspacePanel refactor: the toolbar
  // is now a full-width band ABOVE the row that <main> and the panel share, so
  // in the standalone app its width and the window's are the same number. The
  // measurement still has to be the element's, because a library consumer mounts
  // the editor into a container narrower than their page — which is the geometry
  // `e2e/cases/surfaces.mjs` reproduces to tell this apart from a media query.
  useEffect(() => {
    const el = rootRef.current;
    const check = () => {
      const w = el?.getBoundingClientRect().width ?? window.innerWidth;
      // Hysteresis so a scrollbar or divider drag near the boundary can't flap.
      setIsCompact((prev) => (prev ? w < TOOLBAR_COMPACT_BP + 24 : w < TOOLBAR_COMPACT_BP));
    };
    check();
    if (el && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(check);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // One uncancelled timer per toolbar click used to be left behind; on a
  // library host that unmounts the editor it fired against a torn-down one.
  const execTickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (execTickRef.current) clearTimeout(execTickRef.current); }, []);

  const exec = useCallback((cmd: string, val?: Parameters<typeof dispatch>[1]) => {
    dispatch(cmd, val);
    // Tiptap transactions flush asynchronously — defer the format query by one
    // macrotask so the editor state is fully committed before we read it.
    if (execTickRef.current) clearTimeout(execTickRef.current);
    execTickRef.current = setTimeout(() => { execTickRef.current = null; updateFormats(true); }, 0);
    const DECORATIVE_CMDS = new Set(["foreColor", "unsetColor", "hiliteColor", "unsetHighlight", "fontFamily"]);
    if (syncMode === "clean" && DECORATIVE_CMDS.has(cmd)) {
      toast.show(t("toolbar.appliedLocallySwitchToStyled"), "warning");
    }
  }, [dispatch, updateFormats, syncMode, toast, t]);

  const blockFmt = st.heading ? "h" + st.heading : st.blockquote ? "blockquote" : "p";
  const fontName = st.fontFamily || "Arial";
  const showExpanded = !isCompact || expanded || pinned;

  const compactControls = (<>
    <ButtonGroup>
      {toggleFindReplace && (
        <TbBtn
          icon={Search}
          title={t("toolbar.searchAndReplaceKeys", { keys: displayKeys("⌘F") })}
          active={showFindReplace}
          onClick={toggleFindReplace}
        />
      )}
      <TbBtn icon={Undo2} title={t("toolbar.undoKeys", { keys: displayKeys("⌘Z") })} onClick={() => exec("undo")} />
      <TbBtn icon={Redo2} title={t("toolbar.redoKeys", { keys: displayKeys("⌘⇧Z") })} onClick={() => exec("redo")} />
    </ButtonGroup>
    <ButtonGroup>
      <TbBtn icon={Bold} title={t("toolbar.boldKeys", { keys: displayKeys("⌘B") })} active={st.bold} onClick={() => exec("bold")} />
      <TbBtn icon={Italic} title={t("toolbar.italicKeys", { keys: displayKeys("⌘I") })} active={st.italic} onClick={() => exec("italic")} />
      <TbBtn icon={Underline} title={t("toolbar.underlineKeys", { keys: displayKeys("⌘U") })} active={st.underline} onClick={() => exec("underline")} />
      <TbBtn icon={Strikethrough} title={t("toolbar.strike")} active={st.strike} onClick={() => exec("strikethrough")} />
    </ButtonGroup>
    {isCompact && (
      <ButtonGroup>
        <Button
          onClick={() => setExpanded(!expanded)}
          disabled={pinned} // Disables the button when pinned
          size="icon"
          variant={showExpanded ? "default_soft" : "outline"}
          title={pinned ? t("toolbar.unpinToCollapse") : (showExpanded ? t("toolbar.collapseToolbar") : t("toolbar.expandToolbar"))}
          className={cn("h-8 w-8", showExpanded && SOFT_ACTIVE_INK)}
        >
          {showExpanded ? <ChevronUp className={pinned ? "opacity-50" : ""} /> : <ChevronDown />}
        </Button>
        <Button
          onClick={() => {
            setPinned(!pinned);
            // Optional: Automatically clean up the 'expanded' state when pinning
            if (!pinned) setExpanded(false); 
          }}
          title={pinned ? t("toolbar.unpinToolbar") : t("toolbar.pinToolbar")}
          size="icon"
          variant={pinned ? "default_soft" : "outline"}
          className={cn("size-8", pinned && SOFT_ACTIVE_INK)}
        >
          {pinned ? <Pin /> : <PinOff />}
        </Button>
      </ButtonGroup>
    )}
  </>
  )
  // Shared Block/Font dropdowns — rendered in both desktop and mobile-expanded
  // layouts (previously duplicated verbatim).
  const blockDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger render={
        // The visible text is the CURRENT block type; the name keeps it (label
        // in name) and says what the control is.
        <Button variant="outline" size="sm" aria-label={t("toolbar.blockType", { type: blockOptions.find((o) => o.value === blockFmt)?.label ?? t("toolbar.paragraph") })} className="h-8 min-w-[108px] justify-between gap-1 px-2 font-normal">
          {blockOptions.find((o) => o.value === blockFmt)?.label ?? t("toolbar.paragraph")}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      } />
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {blockOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className={blockFmt === option.value ? "bg-accent font-semibold" : ""}
            onClick={() => {
              if (option.value === "blockquote") exec("blockquote");
              else exec("heading", option.value.startsWith("h") ? parseInt(option.value[1]!) : 0);
            }}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const fontDropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button variant="outline" size="sm" aria-label={t("toolbar.fontLabel", { font: fontOptions.find((o) => o.value === fontName)?.label ?? fontName })} className="h-8 min-w-[84px] justify-between gap-1 px-2 font-normal">
          {fontOptions.find((o) => o.value === fontName)?.label ?? fontName}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </Button>
      } />
      <DropdownMenuContent align="start" className="min-w-[120px]">
        {fontOptions.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className={fontName === option.value ? "bg-accent font-semibold" : ""}
            style={{ fontFamily: option.value }}
            onClick={() => exec("fontFamily", option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const blockFontControls = (
    <>
      {blockDropdown}
      <Divider />
      {fontDropdown}
      <Divider />
    </>
  );

  const expandedControls = (<>

    {/* Block & Font Selectors (single source; shown on desktop directly) */}
    {!isCompact && blockFontControls}
    {/* Expanded Row Content */}
    {showExpanded && (
      <>
        {/* Same dropdowns on mobile when expanded */}
        {isCompact && blockFontControls}

        <ButtonGroup>
          <TbBtn icon={Superscript} title={t("toolbar.superscript")} active={st.superscript} onClick={() => exec("superscript")} />
          <TbBtn icon={Subscript} title={t("toolbar.subscript")} active={st.subscript} onClick={() => exec("subscript")} />
        </ButtonGroup>

        <Divider />

        <ButtonGroup>
          <TbBtn icon={List} title={t("toolbar.bulletList")} active={st.bulletList} onClick={() => exec("bulletList")} />
          <TbBtn icon={ListOrdered} title={t("toolbar.numberedList")} active={st.orderedList} onClick={() => exec("orderedList")} />
          <TbBtn icon={ListTodo} title={t("toolbar.taskList")} active={st.taskList} onClick={() => exec("taskList")} />
          <TbBtn icon={Outdent} title={t("toolbar.outdent")} hint={t("toolbar.liftAListItemOut")} onClick={() => exec("outdent")} />
          <TbBtn icon={Indent} title={t("toolbar.indent")} hint={t("toolbar.nestAListItemMarkdown")} onClick={() => exec("indent")} />
        </ButtonGroup>

        <Divider />

        <ButtonGroup>
          {/* Alignment is the one formatting feature plain Markdown cannot record
              at all, so the tooltip says so rather than leaving the fidelity
              badge to break the news after the fact. */}
          <TbBtn icon={AlignLeft} title={t("toolbar.alignLeft")} hint={t("toolbar.notCarriedByPlainMarkdown")} active={st["textAlign"] === "left" || !st["textAlign"]} onClick={() => exec("alignLeft")} />
          <TbBtn icon={AlignCenter} title={t("toolbar.center")} hint={t("toolbar.notCarriedByPlainMarkdown")} active={st["textAlign"] === "center"} onClick={() => exec("alignCenter")} />
          <TbBtn icon={AlignRight} title={t("toolbar.alignRight")} hint={t("toolbar.notCarriedByPlainMarkdown")} active={st["textAlign"] === "right"} onClick={() => exec("alignRight")} />
        </ButtonGroup>

        <Divider />

        {/* Text colour and highlight are two DISTINCT controls, so they are two
            spaced buttons, not one joined ButtonGroup — grouped flush, their
            chevrons and colour bars ran together and read as a single collided
            control. The flow container spaces them like every other control. */}
        <TbColor
          value={st.color || ""}
          onChange={(v) => exec("foreColor", v)}
          onClear={() => exec("unsetColor")}
          title={t("toolbar.textColor")}
        />
        <TbColor
          value={st.highlight || ""}
          onChange={(v) => exec("hiliteColor", v)}
          onClear={() => exec("unsetHighlight")}
          title={t("toolbar.highlightColor")}
          isHighlight
        />

        <Divider />

        <ButtonGroup>
          <TbBtn icon={Link} title={t("toolbar.linkKeys", { keys: displayKeys("⌘K") })} onClick={async () => { const u = await prompt(t("toolbar.insertLink"), { placeholder: t("toolbar.linkUrlPlaceholder"), description: t("toolbar.enterTheUrlForTheLink") }); if (u) exec("createLink", u); }} />
          <TbBtn icon={Image} title={t("toolbar.image")} onClick={async () => { const img = await promptImage(prompt); if (img) exec("insertImage", img); }} />
        </ButtonGroup>

        <Divider />

        <div className="relative">
          <TbBtn icon={TableIcon} title={t("toolbar.insertTable")} onClick={() => setShowTablePicker(!showTablePicker)} />
          {showTablePicker && (
            <TableGridPicker
              onSelect={(opts) => { exec("insertTable", opts); setShowTablePicker(false); }}
              onClose={() => setShowTablePicker(false)}
            />
          )}
        </div>

        {/* Insert menu — formula / diagram / score / code, works in both panes */}
        <DropdownMenu>
          <DropdownMenuTrigger render={
            <Button variant="outline" size="sm" className="h-8 gap-1 px-2 font-normal" title={t("toolbar.insert")}>
              <Plus className="h-3.5 w-3.5" /> {t("toolbar.insert")}
              <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
            </Button>
          } />
          <DropdownMenuContent align="start" className="min-w-[190px]">
            <DropdownMenuItem onClick={async () => {
              const v = await equation(t("toolbar.insertFormulaBlock"), { display: "block", description: t("toolbar.latexRenderedWithKatex") });
              if (v && v.trim()) exec("insertMathBlock", v);
            }}>
              <Sigma className="mr-2 size-3.5" /> {t("toolbar.formulaBlock")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={async () => {
              const v = await equation(t("toolbar.insertInlineFormula"), { display: "inline", description: t("toolbar.inlineLatex") });
              if (v && v.trim()) exec("insertMathInline", v);
            }}>
              <Sigma className="mr-2 size-3.5" /> {t("toolbar.inlineFormula")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exec("insertMermaid")}>
              <Workflow className="mr-2 size-3.5" /> {t("toolbar.diagramMermaid")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exec("insertAbc")}>
              <Music className="mr-2 size-3.5" /> {t("toolbar.musicScoreAbc")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => exec("codeBlock")}>
              <Code className="mr-2 size-3.5" /> {t("toolbar.codeBlock")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ButtonGroup>
          <TbBtn icon={Icons.HorizontalRule} title={t("toolbar.horizontalRule")} onClick={() => exec("horizontalRule")} />
          <TbBtn icon={RemoveFormatting} title={t("toolbar.clearFormat")} onClick={() => exec("removeFormat")} />
        </ButtonGroup>

        {/* Contextual Table Controls */}
        {st.table && (
          <>
            <Divider />
            <ButtonGroup className="animate-in fade-in zoom-in-95">
              <TbBtn icon={PlusSquare} title={t("toolbar.addRow")} onClick={() => exec("tableAddRow")} />
              <TbBtn icon={MinusSquare} title={t("toolbar.delRow")} onClick={() => exec("tableDeleteRow")} />
              {/* A GFM table is DEFINED by its delimiter row, so there is no
                  markdown meaning to "toggle the header" — the command is a
                  deliberate no-op on that side. Gating on `mode` left the button
                  visible and inert in split view whenever the markdown pane had
                  focus; gate on the pane a command would actually reach. */}
              {(st["pane"] ?? (mode === "md" ? "md" : "html")) !== "md" && (
                <TbBtn icon={Layout} title={t("toolbar.toggleHeader")} onClick={() => exec("toggleHeaderRow")} />
              )}
              <TbBtn icon={Trash2} title={t("toolbar.deleteTable")} onClick={() => exec("deleteTable")} className="w-8 h-8 text-destructive hover:bg-destructive/10" />
            </ButtonGroup>
          </>
        )}
      </>
    )}

  </>)

  return (
    <>
      <div
        ref={rootRef}
        data-tour="toolbar"
        data-print-hide
        role="toolbar"
        aria-label={t("toolbar.formatting")}
        className="bg-card/80 border-b border-border transition-all duration-300 px-4 pt-1.5 pb-0"
      >

        {/* 1. RIGHT CONTROLS (Floated Right)
        Must come first in the DOM. This pins it to the top right, allowing 
        all inline elements below to flow around it and tuck under it when wrapped.
      */}
        <div id="toolbar-right-controls" className="float-right ml-2 mb-1.5 flex items-center gap-2">
          {/* Clear / Revert now live in the Edit and File menus; Save stays here
              (high-frequency) alongside Undo/Redo in the compact controls.
              Named explicitly: below `sm` the "Save" text is display:none,
              which left an icon-only button with no name at all. */}
          <ButtonGroup>
            <Tooltip>
              <TooltipTrigger render={
                // Reflect the LIVE save state so a click visibly does something:
                // Save → Saving… → ✓ Changes saved, then back to Save on the next
                // edit. aria-label stays "Save" (the control is always the Save
                // button; the toolbar + a11y tests pin that accessible name) — only
                // the visible icon and text track the status.
                <Button
                  variant="ghost"
                  onClick={onSave}
                  disabled={!isDirty}
                  aria-label={t("common.save")}
                  className={cn("h-8 hover:bg-card", saveStatus === "saved" && "text-success")}
                >
                  {saveStatus === "saving" ? (
                    <Loader2 className="animate-spin text-muted-foreground" />
                  ) : saveStatus === "saved" ? (
                    <Check className="text-success" />
                  ) : (
                    <Save className="text-success" />
                  )}
                  <span className="hidden sm:inline-block">
                    {saveStatus === "saving"
                      ? t("status.saving")
                      : saveStatus === "saved"
                        ? t("status.changesSaved")
                        : t("common.save")}
                  </span>
                </Button>
              } />
              <TooltipContent side="bottom" className="text-[10px] font-bold">
                {t.rich("toolbar.saveWithKeys", { keys: displayKeys("⌘S"), kbd: (s) => <kbd className="ml-2 font-sans opacity-60">{s}</kbd> })}
              </TooltipContent>
            </Tooltip>
          </ButtonGroup>
        </div>

        {/* 2. FLOWING CONTROLS
        A block wrapper. The `[&>*]` selector automatically makes every direct child 
        (ButtonGroups, Dropdowns, Dividers) act like words in a paragraph (`inline-flex`), 
        and gives them a right/bottom margin to perfectly simulate `gap-2`.
      */}
        <div className="block w-full">
          <div className="*:inline-flex [&>*]:align-middle *:mr-2 *:mb-1.5">
            {compactControls}
            {showExpanded && expandedControls}
          </div>
        </div>

        {/* Clearfix guarantees the parent height contains floated elements */}
        <div className="clear-both" />
      </div>
    </>
  );
}

export const EditorToolbar = React.memo(EditorToolbarComponent);