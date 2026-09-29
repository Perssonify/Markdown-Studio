import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_NAME, MODES, VERSION } from "../constants";
import { ChevronLeft, ChevronRight, FileText, Menu as MenuIcon, Network, PenLine, SettingsIcon, StickyNote } from "lucide-react";
import { useTheme } from "next-themes";
import React, { type ReactNode, useEffect, useRef, useState } from "react";
import { useIsMobile } from "../hooks/use-mobile";
import { COMMON_SHORTCUTS, displayKeys } from "../data/shortcuts";
import { getStoredPalette, PALETTES, setPalette } from "../theme/palette";
import { useUIStore } from "../store/uiStore";
import { adsAvailable } from "../utils/build-gates";
import { useDialog } from "./DialogProvider";
import { ModeSwitcher } from "./ModeSwitcher";
import { TableGridPicker } from "./TableGridPicker";
import { THEME_OPTIONS, ThemeSwatch } from "./ThemeControls";
import { selectMenuBody, type MenuPrimitives } from "./SelectMenuContent";

// Primitive family for the shared Select ▸ … renderer (dropdown variant).
const DROPDOWN_SELECT_PRIMS = {
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  Item: DropdownMenuItem,
  Group: DropdownMenuGroup,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
} as unknown as MenuPrimitives;

export interface MenuBarProps {
  activeDocId: string | null;
  docTitle: string;
  mode: string;
  setMode: (mode: string) => void;
  onAction: (type: string, data?: unknown) => void;
  dispatch: (cmd: string, val?: unknown) => void;
  onNew: () => void;
  onSave: () => void;
  onRevert: () => void;
  onClose: () => void;
  onToggleSidebar: () => void;
  onFindReplace: () => void;
  /** Open Find & Replace with the replace row expanded (⌘H). */
  onReplace?: () => void;
  /** Clipboard/selection actions on the focused pane (cut/copy/paste/selectAll). */
  onClipboard?: (action: "cut" | "copy" | "paste" | "selectAll") => void;
  onSearch: () => void;
  onSettings: () => void;
  /** Toggles the graph view (open ⇄ close). */
  onGraph: () => void;
  onCards?: () => void;
  /** Return to the editor surface (the third option in the surface switcher). */
  onEditor?: () => void;
  /** Opens the in-editor Outline panel (bottom tray). */
  onOutline?: () => void;
  /** Whether the graph view is currently open (drives the toggle's state). */
  graphActive?: boolean;
  cardsActive?: boolean;
  /** Opens the Memory & undo history sheet. */
  onMemory?: () => void;
  /** Opens the Version history (recoverable snapshots) sheet. */
  onVersionHistory?: () => void;
  /** Opens the share / embed link builder dialog. */
  onLinkBuilder?: () => void;
  /** Standalone-app navigation. When provided, these open interior pages
   *  (/about, /help) instead of the built-in dialogs used by embedders. */
  onAbout?: () => void;
  onHelp?: () => void;
  onStartTour?: () => void;
}

/** A single top-level menu (File, Edit, …) rendered as a ghost button + dropdown. */
function Menu({ label, disabled, children }: { label: string; disabled?: boolean; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="h-7 px-2 text-[13px] font-normal text-foreground/80 data-popup-open:bg-accent"
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The three workspace surfaces, as ONE selection.
 *
 * Editor is a first-class choice, not "both overlays off": leaving a view by
 * un-toggling the button you came in through reads as an escape hatch, whereas
 * three radio-style options say plainly that exactly one surface is showing.
 * Same idiom as the ModeSwitcher beside it — icon always, label from `lg` up
 * and always for the active one, so the current surface is never unlabeled.
 */
const SURFACES = [
  { id: "editor", icon: PenLine, label: "Editor", hint: "" },
  { id: "cards", icon: StickyNote, label: "Cards", hint: "⌘⇧K" },
  { id: "map", icon: Network, label: "Map", hint: "⌘⇧G" },
] as const;

// Menu shortcut hint, converted for the current platform (⌘B → Ctrl+B).
const Sc = ({ children }: { children: ReactNode }) => (
  <DropdownMenuShortcut>{typeof children === "string" ? displayKeys(children) : children}</DropdownMenuShortcut>
);

/**
 * Application menu bar (File · Edit · Insert · View · Format · Tools · Help).
 *
 * The menu *content* is defined once (see `sections` below) and rendered two
 * ways: as a row of dropdowns on desktop, and — on phones, where seven menus
 * would overflow and get concealed — as a single ☰ button opening one grouped
 * dropdown. The high-frequency mode switcher and settings gear stay visible in
 * both layouts. This is a presentation layer only; every item reuses an existing
 * editor handler.
 */
export const MenuBar = React.memo(function MenuBar(props: MenuBarProps) {
  const { prompt, equation } = useDialog();
  // Raw `theme` (not resolvedTheme) so "System" is a genuine, selectable choice
  // rather than being folded into the light/dark it currently resolves to.
  const { theme, setTheme } = useTheme();
  const isMobile = useIsMobile();
  const caseContentOnly = useUIStore((s) => s.caseContentOnly);
  const setCaseContentOnly = useUIStore((s) => s.setCaseContentOnly);
  const readOnly = useUIStore((s) => s.readOnly);
  const setReadOnly = useUIStore((s) => s.setReadOnly);
  const focusMode = useUIStore((s) => s.focusMode);
  const setFocusMode = useUIStore((s) => s.setFocusMode);
  const showAds = useUIStore((s) => s.showAds);
  const setShowAds = useUIStore((s) => s.setShowAds);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<null | "about" | "shortcuts">(null);
  // Mobile ☰ drill-down: null = the collapsed top-level group list; a number =
  // the index of the section whose items are currently shown. Reset when the
  // menu closes so it always reopens at the group list.
  const [mobileSection, setMobileSection] = useState<number | null>(null);
  const [palette, setPaletteState] = useState("amber");
  const hasDoc = !!props.activeDocId;
  const surface: (typeof SURFACES)[number]["id"] =
    props.cardsActive ? "cards" : props.graphActive ? "map" : "editor";

  // Read the persisted accent after mount (avoids a hydration mismatch).
  useEffect(() => setPaletteState(getStoredPalette()), []);
  const changePalette = (id: string) => {
    setPalette(id);
    setPaletteState(id);
  };

  const openFilePicker = () => fileInputRef.current?.click();

  const insertWithPrompt = async (cmd: string, title: string, opts: { placeholder: string; description: string }) => {
    const v = await prompt(title, opts);
    if (v && String(v).trim()) props.dispatch(cmd, v);
  };

  // Menu content, defined once and reused across the desktop row and the mobile
  // grouped dropdown. `disabled` greys out sections that need an open document.
  const sections: { label: string; disabled?: boolean; content: ReactNode }[] = [
    {
      label: "File",
      content: (
        <>
          <DropdownMenuItem onClick={props.onNew}>New document<Sc>⌘N</Sc></DropdownMenuItem>
          <DropdownMenuItem onClick={openFilePicker}>Open file…</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Import</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={openFilePicker}>File(s) / archive…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onAction("import-url")}>From URL…</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!hasDoc}>Export</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => props.onAction("export-md")}>Markdown (.md)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onAction("export-html")}>HTML (.html)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onAction("export-json")}>ProseMirror JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onAction("export-docx")}>Word (.docx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onAction("export-pdf")}>PDF / Print…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => props.onAction("export-all-zip")}>All documents (.zip)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onAction("export-backup-zip")}>Full backup (.zip) — restorable</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!hasDoc} onClick={props.onSave}>Save<Sc>⌘S</Sc></DropdownMenuItem>
          <DropdownMenuItem disabled={!hasDoc} onClick={props.onRevert}>Revert to saved</DropdownMenuItem>
          <DropdownMenuItem disabled={!hasDoc} onClick={props.onClose}>Close document</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={props.onSettings}>Settings / Preferences…</DropdownMenuItem>
        </>
      ),
    },
    {
      label: "Edit",
      content: (
        <>
          {/* Undo / redo */}
          <DropdownMenuItem disabled={!hasDoc} onClick={() => props.dispatch("undo")}>Undo<Sc>⌘Z</Sc></DropdownMenuItem>
          <DropdownMenuItem disabled={!hasDoc} onClick={() => props.dispatch("redo")}>Redo<Sc>⌘⇧Z</Sc></DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Clipboard */}
          <DropdownMenuItem disabled={!hasDoc || readOnly} onClick={() => props.onClipboard?.("cut")}>Cut<Sc>⌘X</Sc></DropdownMenuItem>
          <DropdownMenuItem disabled={!hasDoc} onClick={() => props.onClipboard?.("copy")}>Copy<Sc>⌘C</Sc></DropdownMenuItem>
          <DropdownMenuItem disabled={!hasDoc || readOnly} onClick={() => props.onClipboard?.("paste")}>Paste<Sc>⌘V</Sc></DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Selection — Select all sits with the structured Select… submenu */}
          <DropdownMenuItem disabled={!hasDoc} onClick={() => props.dispatch("selectAll")}>Select all<Sc>⌘A</Sc></DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!hasDoc}>Select by type…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-[70vh] overflow-y-auto">
              {selectMenuBody(DROPDOWN_SELECT_PRIMS, props.dispatch)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          {/* Formatting */}
          <DropdownMenuItem disabled={!hasDoc || readOnly} onClick={() => props.dispatch("clearFormatting")}>Clear formatting</DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Find / search */}
          <DropdownMenuItem disabled={!hasDoc} onClick={props.onFindReplace}>Find…<Sc>⌘F</Sc></DropdownMenuItem>
          {props.onReplace && (
            <DropdownMenuItem disabled={!hasDoc} onClick={props.onReplace}>Replace…<Sc>⌘H</Sc></DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={props.onSearch}>Search all notes…<Sc>⌘⇧F</Sc></DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Copy the whole document to the clipboard in another format */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!hasDoc}>Copy as…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => props.onAction("md")}>Markdown</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onAction("html")}>HTML</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.onAction("json")}>ProseMirror JSON</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          {/* Destructive — kept last, on its own */}
          <DropdownMenuItem disabled={!hasDoc || readOnly} onClick={() => props.onAction("clear")}>Clear document…</DropdownMenuItem>
        </>
      ),
    },
    {
      label: "Insert",
      disabled: !hasDoc || readOnly,
      content: (
        <>
          <DropdownMenuItem onClick={() => insertWithPrompt("createLink", "Insert Link", { placeholder: "https://example.com", description: "Enter the URL for the link." })}>Link…<Sc>⌘K</Sc></DropdownMenuItem>
          <DropdownMenuItem onClick={() => insertWithPrompt("insertImage", "Insert Image", { placeholder: "https://example.com/image.png", description: "Enter the image URL." })}>Image…</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Table</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="p-0">
              <TableGridPicker
                inline
                onSelect={(opts) => props.dispatch("insertTable", opts)}
                onClose={() => {}}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={async () => { const v = await equation("Insert Formula (block)", { display: "block", description: "LaTeX rendered with KaTeX ($$…$$)." }); if (v && v.trim()) props.dispatch("insertMathBlock", v); }}>Formula (block)…</DropdownMenuItem>
          <DropdownMenuItem onClick={async () => { const v = await equation("Insert inline formula", { display: "inline", description: "Inline LaTeX ($…$)." }); if (v && v.trim()) props.dispatch("insertMathInline", v); }}>Inline formula…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.dispatch("insertMermaid")}>Diagram (Mermaid)</DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.dispatch("insertAbc")}>Music score (ABC)</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Callout</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => props.dispatch("insertCallout", "note")}>Note</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("insertCallout", "tip")}>Tip</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("insertCallout", "important")}>Important</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("insertCallout", "warning")}>Warning</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("insertCallout", "caution")}>Caution</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => props.dispatch("insertDetails")}>Collapsible details</DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.dispatch("codeBlock")}>Code block</DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.dispatch("horizontalRule")}>Horizontal rule</DropdownMenuItem>
        </>
      ),
    },
    {
      label: "View",
      content: (
        <>
          <DropdownMenuRadioGroup value={props.mode} onValueChange={(v) => { if (!readOnly) props.setMode(v); }}>
            <DropdownMenuRadioItem value={MODES.MD} disabled={readOnly}>Markdown</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value={MODES.HTML} disabled={readOnly}>Rich text</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value={MODES.SPLIT} disabled={readOnly}>Split</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={props.onToggleSidebar}>Toggle workspace panel<Sc>⌘⇧D</Sc></DropdownMenuItem>
          {props.onOutline && <DropdownMenuItem onClick={props.onOutline}>Outline</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {/* The same three-way surface choice as the top-bar switcher, so the
              menu can't imply the views are independent toggles. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={surface}
              onValueChange={(v) => {
                if (v === "cards") props.onCards?.();
                else if (v === "map") props.onGraph();
                else props.onEditor?.();
              }}
            >
              <DropdownMenuRadioItem value="editor">Editor</DropdownMenuRadioItem>
              {props.onCards && <DropdownMenuRadioItem value="cards">Cards<Sc>⌘⇧K</Sc></DropdownMenuRadioItem>}
              <DropdownMenuRadioItem value="map">Relationship map<Sc>⌘⇧G</Sc></DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={readOnly} onCheckedChange={(v) => setReadOnly(!!v)}>
            Read-only mode
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={focusMode} onCheckedChange={(v) => setFocusMode(!!v)}>
            Focus mode
          </DropdownMenuCheckboxItem>
          {/* Placeholder ad slots are a development-only surface (A078). */}
          {adsAvailable() && (
            <DropdownMenuCheckboxItem checked={showAds} onCheckedChange={(v) => setShowAds(!!v)}>
              Show ads
            </DropdownMenuCheckboxItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Appearance</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {/* GroupLabel MUST live inside a Group (Base UI throws otherwise). */}
              <DropdownMenuGroup>
                <DropdownMenuLabel>Theme</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(v)}>
                  {THEME_OPTIONS.map((o) => (
                    <DropdownMenuRadioItem key={o.id} value={o.id}>
                      <ThemeSwatch theme={o.id} className="mr-2" />
                      {o.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Accent / style</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={palette} onValueChange={changePalette}>
                  {PALETTES.map((p) => (
                    <DropdownMenuRadioItem key={p.id} value={p.id}>
                      <span
                        aria-hidden
                        className="mr-2 inline-block size-3.5 shrink-0 rounded-full border border-border"
                        style={{ background: p.swatch }}
                      />
                      {p.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </>
      ),
    },
    {
      label: "Format",
      disabled: !hasDoc || readOnly,
      content: (
        <>
          <DropdownMenuItem onClick={() => props.dispatch("bold")}>Bold<Sc>⌘B</Sc></DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.dispatch("italic")}>Italic<Sc>⌘I</Sc></DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.dispatch("underline")}>Underline<Sc>⌘U</Sc></DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.dispatch("strikethrough")}>Strikethrough<Sc>⌘⇧X</Sc></DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.dispatch("code")}>Inline code<Sc>⌘E</Sc></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Heading</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => props.dispatch("heading", 0)}>Normal text</DropdownMenuItem>
              {[1, 2, 3, 4, 5, 6].map((lvl) => (
                <DropdownMenuItem key={lvl} onClick={() => props.dispatch("heading", lvl)}>Heading {lvl}</DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Lists</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => props.dispatch("bulletList")}>Bulleted list</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("orderedList")}>Numbered list</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("taskList")}>Task list</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onClick={() => props.dispatch("blockquote")}>Blockquote</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Change case</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => props.dispatch("changeCase", "upper")}>UPPERCASE</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("changeCase", "lower")}>lowercase</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("changeCase", "title")}>Title Case</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>All headings</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => props.dispatch("headingsCase", "upper")}>UPPERCASE</DropdownMenuItem>
                <DropdownMenuItem onClick={() => props.dispatch("headingsCase", "lower")}>lowercase</DropdownMenuItem>
                <DropdownMenuItem onClick={() => props.dispatch("headingsCase", "title")}>Title Case</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={caseContentOnly}
                onCheckedChange={(v) => setCaseContentOnly(!!v)}
              >
                Content only (skip code &amp; links)
              </DropdownMenuCheckboxItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            {/* Alignment has no plain-Markdown representation; say so here rather
                than letting the fidelity badge be the first the user hears of it. */}
            <DropdownMenuSubTrigger title="Plain Markdown cannot record alignment — the fidelity indicator flags it, and it is not carried by an export.">
              Align
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={() => props.dispatch("alignLeft")}>Left</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("alignCenter")}>Center</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("alignRight")}>Right</DropdownMenuItem>
              <DropdownMenuItem onClick={() => props.dispatch("alignJustify")}>Justify</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => props.dispatch("removeFormat")}>Clear formatting</DropdownMenuItem>
        </>
      ),
    },
    {
      label: "Tools",
      content: (
        <>
          <DropdownMenuItem disabled={!hasDoc} onClick={() => props.onAction("prompt")}>Copy as AI prompt</DropdownMenuItem>
          <DropdownMenuItem onClick={() => props.onAction("export-graph")}>Copy graph JSON</DropdownMenuItem>
          {props.onLinkBuilder && (
            <DropdownMenuItem onClick={props.onLinkBuilder}>Share / embed link…</DropdownMenuItem>
          )}
          {(props.onVersionHistory || props.onMemory) && <DropdownMenuSeparator />}
          {props.onVersionHistory && (
            <DropdownMenuItem onClick={props.onVersionHistory}>Version history…</DropdownMenuItem>
          )}
          {props.onMemory && (
            <DropdownMenuItem onClick={props.onMemory}>Memory &amp; undo history…</DropdownMenuItem>
          )}
        </>
      ),
    },
    {
      label: "Help",
      content: (
        <>
          {props.onHelp && <DropdownMenuItem onClick={props.onHelp}>Help &amp; documentation</DropdownMenuItem>}
          {props.onStartTour && <DropdownMenuItem onClick={props.onStartTour}>Take a guided tour</DropdownMenuItem>}
          <DropdownMenuItem onClick={() => (props.onHelp ? props.onHelp() : setDialog("shortcuts"))}>Keyboard shortcuts</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => (props.onAbout ? props.onAbout() : setDialog("about"))}>About {APP_NAME}</DropdownMenuItem>
        </>
      ),
    },
  ];

  return (
    <div data-tour="menubar" className="flex h-10 shrink-0 items-center gap-0.5 border-b border-border bg-card/60 px-2">
      {/* Hidden input backing File → Open file… */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.markdown,.mdown,.txt,.html,.htm,.json,.docx,.zip,.tar,.gz,.tgz"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) props.onAction("import", e.target.files);
          e.target.value = "";
        }}
      />

      {isMobile ? (
        /* Phone: a single ☰ menu that DRILLS DOWN — the top level is the
           collapsed group list (File, Edit, …); tapping a group slides into its
           items with a "‹ Back" row. This replaced the old flat dump of all
           seven sections at once (an unnavigable long scroll). Navigation rows
           use closeOnClick={false} so selecting them moves between levels
           instead of dismissing the menu; leaf items still close on select.
           Reset to the group list whenever the menu closes. */
        <DropdownMenu onOpenChange={(open) => { if (!open) setMobileSection(null); }}>
          <DropdownMenuTrigger
            render={
              <Button data-tour="menus" variant="ghost" size="icon" className="size-10 text-foreground/80" aria-label="Menu" title="Menu" />
            }
          >
            <MenuIcon className="size-6" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[80vh] w-72 overflow-y-auto">
            {(() => {
              const active = mobileSection !== null ? sections[mobileSection] : null;
              if (!active) {
                // Level 0 — collapsed groups. Each row drills into a section.
                return sections.map((s, i) => (
                  <DropdownMenuItem
                    key={s.label}
                    closeOnClick={false}
                    disabled={s.disabled}
                    onClick={(e) => { e.preventDefault(); if (!s.disabled) setMobileSection(i); }}
                  >
                    {s.label}
                    <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                  </DropdownMenuItem>
                ));
              }
              // Level 1 — the selected section's items, with a Back row.
              return (
                <>
                  <DropdownMenuItem
                    closeOnClick={false}
                    onClick={(e) => { e.preventDefault(); setMobileSection(null); }}
                    className="text-muted-foreground"
                  >
                    <ChevronLeft className="size-4" />
                    All menus
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {/* GroupLabel MUST live inside a Group (Base UI throws otherwise —
                      this exact omission crashed the whole app on phone tap once). */}
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {active.label}
                    </DropdownMenuLabel>
                    {active.content}
                  </DropdownMenuGroup>
                </>
              );
            })()}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        /* Desktop: the full menu row. Horizontal-scrolls only as a last resort.
           Content-sized (not flex-1) so the tour spotlight hugs the actual
           menu buttons; min-w-0 + shrink still lets it scroll when squeezed. */
        <div data-tour="menus" className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.map((s) => (
            <Menu key={s.label} label={s.label} disabled={s.disabled}>
              {s.content}
            </Menu>
          ))}
        </div>
      )}

      {/* Right side. Three groups, coarse → fine: the open document's identity
          (icon + title), then "what am I looking at" — the surface switcher
          (Editor modes · Cards · Map) — then settings. The title group hides
          first when space is tight.

          Cards and Map sit together, in one bordered group, because they are
          peers: two full-canvas views of the whole library that replace the
          document surface. Map used to be a lone button here AND a duplicate
          in the status bar (same Network icon, same action, opposite corners)
          while Cards had no top-bar presence at all. */}
      <div className="ml-auto flex shrink-0 items-center gap-2 pl-2 sm:gap-3">
        {props.activeDocId && (
          <div className="hidden min-w-0 max-w-[22ch] items-center gap-1.5 md:flex" title={props.docTitle}>
            <FileText className="size-3.5 shrink-0 text-muted-foreground/60" />
            {/* A8: `leading-none` makes the line box exactly the font size, so with
                `truncate`'s overflow:hidden a tall diacritic (Å, Ą) or a descender is
                clipped. `leading-tight` costs a pixel and stops that. */}
            <span className="truncate text-[13px] font-medium leading-tight text-foreground/90">
              {props.docTitle || "Untitled"}
            </span>
          </div>
        )}
        {props.activeDocId && <div className="hidden h-5 w-px bg-border md:block" aria-hidden />}
        <span data-tour="mode-switcher">
          <ModeSwitcher mode={props.mode} setMode={props.setMode} />
        </span>
        <ButtonGroup data-tour="workspace-views">
          {SURFACES.filter((v) => v.id !== "cards" || props.onCards).map(({ id, icon: Icon, label, hint }) => {
            const active = surface === id;
            return (
              <Button
                key={id}
                data-slot="surface-switcher-button"
                variant={active ? "default" : "outline"}
                size="sm"
                className="h-8 gap-1.5 px-2 pointer-coarse:min-h-9 pointer-coarse:min-w-9"
                title={`${label}${hint ? ` (${displayKeys(hint)})` : ""}`}
                aria-label={label}
                aria-pressed={active}
                onClick={() => {
                  if (id === "cards") props.onCards?.();
                  else if (id === "map") props.onGraph();
                  else props.onEditor?.();
                }}
              >
                <Icon className="size-4" />
                <span
                  className={cn(
                    "hidden text-xs tracking-tight whitespace-nowrap lg:inline-block",
                    active && "inline-block"
                  )}
                >
                  {label}
                </span>
              </Button>
            );
          })}
        </ButtonGroup>
        <Button
          data-tour="settings"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          title="Settings"
          aria-label="Settings"
          onClick={props.onSettings}
        >
          <SettingsIcon className="size-4" />
        </Button>
      </div>

      {/* About / Shortcuts dialogs (embedder fallback when onAbout/onHelp absent) */}
      <AlertDialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent size="default">
          {dialog === "about" ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{APP_NAME}</AlertDialogTitle>
                <AlertDialogDescription>
                  A dual-pane, client-only Markdown editor. Version {VERSION}. Your documents are stored
                  locally in this browser — nothing is uploaded.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => setDialog(null)}>Close</AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Keyboard shortcuts</AlertDialogTitle>
                <AlertDialogDescription>Common actions, shown for this device&apos;s keyboard.</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
{COMMON_SHORTCUTS.map(({ action: label, keys }) => (
                  <div key={label} className="flex items-center justify-between gap-3 border-b border-border/40 py-0.5">
                    <span className="text-muted-foreground">{label}</span>
                    <kbd className="font-mono text-[11px] text-foreground">{displayKeys(keys)}</kbd>
                  </div>
                ))}
              </div>
              <AlertDialogFooter>
                <AlertDialogAction onClick={() => setDialog(null)}>Close</AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});
