import React from "react";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  applyFlavor,
  type MarkdownFeatureSettings,
  type MarkdownFlavor,
} from "../store/settings";
import { useUIStore } from "../store/uiStore";
import { MODES } from "../constants";
import { adminSettingsAvailable, adsAvailable } from "../utils/build-gates";
import { AccentCircleRow, ThemeCircleRow } from "./ThemeControls";

const FLAVORS: { id: MarkdownFlavor; label: string; desc: string }[] = [
  {
    id: "commonmark",
    label: "CommonMark",
    desc: "Strict baseline — no tables or task lists.",
  },
  {
    id: "gfm",
    label: "GitHub Flavored",
    desc: "Tables, task lists, strikethrough, autolinks.",
  },
  { id: "markdown-extra", label: "Markdown Extra", desc: "GFM plus footnotes." },
];

const CORE_TOGGLES: { key: keyof MarkdownFeatureSettings; label: string }[] = [
  { key: "tables", label: "Tables" },
  { key: "taskLists", label: "Task lists" },
  { key: "strikethrough", label: "Strikethrough" },
  { key: "autolink", label: "Autolink URLs" },
  { key: "footnotes", label: "Footnotes" },
];

const RICH_TOGGLES: { key: keyof MarkdownFeatureSettings; label: string }[] = [
  { key: "math", label: "LaTeX math (KaTeX)" },
  { key: "diagrams", label: "UML / diagrams (Mermaid)" },
  { key: "music", label: "Music scores (ABC)" },
  { key: "emoji", label: "Emoji shortcodes" },
  { key: "callouts", label: "Callouts (> [!NOTE])" },
  { key: "details", label: "Collapsible details" },
];

function SettingsSheetInner({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const markdownFeatures = useUIStore((s) => s.markdownFeatures);
  const setMarkdownFeatures = useUIStore((s) => s.setMarkdownFeatures);
  const readOnly = useUIStore((s) => s.readOnly);
  const setReadOnly = useUIStore((s) => s.setReadOnly);
  const showAds = useUIStore((s) => s.showAds);
  const setShowAds = useUIStore((s) => s.setShowAds);
  const contextMenuEnabled = useUIStore((s) => s.contextMenuEnabled);
  const setContextMenuEnabled = useUIStore((s) => s.setContextMenuEnabled);
  const consoleEnabled = useUIStore((s) => s.consoleEnabled);
  const setConsoleEnabled = useUIStore((s) => s.setConsoleEnabled);
  const keyboardShortcutsEnabled = useUIStore((s) => s.keyboardShortcutsEnabled);
  const setKeyboardShortcutsEnabled = useUIStore((s) => s.setKeyboardShortcutsEnabled);
  const mode = useUIStore((s) => s.mode);
  const setMode = useUIStore((s) => s.setMode);
  const editorFontSize = useUIStore((s) => s.editorFontSize);
  const setEditorFontSize = useUIStore((s) => s.setEditorFontSize);
  const editorLineHeight = useUIStore((s) => s.editorLineHeight);
  const setEditorLineHeight = useUIStore((s) => s.setEditorLineHeight);
  const readingWidth = useUIStore((s) => s.readingWidth);
  const setReadingWidth = useUIStore((s) => s.setReadingWidth);
  const spellcheck = useUIStore((s) => s.spellcheck);
  const setSpellcheck = useUIStore((s) => s.setSpellcheck);
  const focusMode = useUIStore((s) => s.focusMode);
  const setFocusMode = useUIStore((s) => s.setFocusMode);

  const toggle = (key: keyof MarkdownFeatureSettings) => (value: boolean) =>
    setMarkdownFeatures((prev) => ({ ...prev, [key]: value }));

  // Read at render: the sheet re-renders when it opens, so a `pf:admin` flag
  // set from the console shows up the next time Settings is opened.
  const showAdmin = adminSettingsAvailable();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(360px,100vw)] p-0 sm:w-[400px]">
        <SheetHeader className="px-5 py-4">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Appearance &amp; Markdown preferences. Saved automatically.
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <ScrollArea className="h-[calc(100dvh-5.5rem)]">
          <div className="space-y-6 px-5 py-4">
            {/* Appearance — theme + accent, mirrored in the View ▸ Appearance menu */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Appearance
              </h3>
              <div className="space-y-1.5">
                <Label className="text-sm">Theme</Label>
                <ThemeCircleRow />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Accent</Label>
                <AccentCircleRow />
              </div>
            </section>

            <Separator />

            {/* Markdown flavor */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Markdown flavor
              </h3>
              <div className="grid gap-2">
                {FLAVORS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    /* Selection was communicated by COLOUR alone — nothing in
                       the accessibility tree said which option was active. */
                    aria-pressed={markdownFeatures.flavor === f.id}
                    onClick={() =>
                      setMarkdownFeatures((prev) => applyFlavor(prev, f.id))
                    }
                    className={cn(
                      "rounded-md border px-3 py-2 text-left transition-colors",
                      markdownFeatures.flavor === f.id
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    )}
                  >
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-muted-foreground">{f.desc}</div>
                  </button>
                ))}
              </div>
            </section>

            <Separator />

            {/* Core features */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Features
              </h3>
              {CORE_TOGGLES.map((t) => (
                <div key={t.key} className="flex items-center justify-between">
                  <Label htmlFor={`feat-${t.key}`} className="text-sm">
                    {t.label}
                  </Label>
                  <Switch
                    id={`feat-${t.key}`}
                    checked={Boolean(markdownFeatures[t.key])}
                    onCheckedChange={toggle(t.key)}
                  />
                </div>
              ))}
            </section>

            <Separator />

            {/* Rich renderers */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Extensions
              </h3>
              {RICH_TOGGLES.map((t) => (
                <div key={t.key} className="flex items-center justify-between">
                  <Label htmlFor={`feat-${t.key}`} className="text-sm">
                    {t.label}
                  </Label>
                  <Switch
                    id={`feat-${t.key}`}
                    checked={Boolean(markdownFeatures[t.key])}
                    onCheckedChange={toggle(t.key)}
                  />
                </div>
              ))}
            </section>

            <Separator />

            {/* Editor behaviour */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Editor
              </h3>
              <div className="space-y-1.5">
                <Label className="text-sm">View mode</Label>
                <div className={cn("inline-flex w-full rounded-md border border-border p-0.5", readOnly && "opacity-50")}>
                  {[
                    { v: MODES.MD, label: "Markdown" },
                    { v: MODES.HTML, label: "Rich text" },
                    { v: MODES.SPLIT, label: "Split" },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      disabled={readOnly}
                      aria-pressed={mode === o.v}
                      onClick={() => setMode(o.v)}
                      className={cn(
                        "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
                        mode === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {readOnly && (
                  <p className="text-[11px] text-muted-foreground">View is locked while read-only mode is on.</p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-readonly" className="text-sm">Read-only mode</Label>
                  <p className="text-xs text-muted-foreground">Disable editing; hide the formatting toolbar.</p>
                </div>
                <Switch id="pref-readonly" checked={readOnly} onCheckedChange={setReadOnly} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-shortcuts" className="text-sm">Keyboard shortcuts</Label>
                  <p className="text-xs text-muted-foreground">Turn off all app keyboard shortcuts (⌘B, ⌘F, ⌘S, …).</p>
                </div>
                <Switch id="pref-shortcuts" checked={keyboardShortcutsEnabled} onCheckedChange={setKeyboardShortcutsEnabled} />
              </div>
            </section>

            <Separator />

            {/* Reading & typography — applied as CSS vars on the editor container
                so both panes honor them; all sticky via localStorage. */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reading &amp; typography
              </h3>
              <div className="space-y-1.5">
                <Label className="text-sm">Font size</Label>
                <div className="inline-flex w-full rounded-md border border-border p-0.5">
                  {[
                    { v: 13, label: "S" },
                    { v: 15, label: "M" },
                    { v: 17, label: "L" },
                    { v: 19, label: "XL" },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      aria-pressed={editorFontSize === o.v}
                      onClick={() => setEditorFontSize(o.v)}
                      className={cn(
                        "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                        editorFontSize === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Line height</Label>
                <div className="inline-flex w-full rounded-md border border-border p-0.5">
                  {[
                    { v: 1.4, label: "Tight" },
                    { v: 1.6, label: "Normal" },
                    { v: 1.8, label: "Relaxed" },
                    { v: 2.1, label: "Loose" },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      aria-pressed={editorLineHeight === o.v}
                      onClick={() => setEditorLineHeight(o.v)}
                      className={cn(
                        "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                        editorLineHeight === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Reading width</Label>
                <div className="inline-flex w-full rounded-md border border-border p-0.5">
                  {/* Characters, not pixels. A reading measure IS a character
                      count, so it must scale with the font-size preference —
                      and as a pixel cap on the container wrapping both panes,
                      "Narrow" only began to bind above a ~1620px viewport, so
                      in the default split layout every option was identical
                      while the control still highlighted and persisted. */}
                  {[
                    { v: 0, label: "Full" },
                    { v: 65, label: "Narrow" },
                    { v: 80, label: "Medium" },
                    { v: 100, label: "Wide" },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      aria-pressed={readingWidth === o.v}
                      onClick={() => setReadingWidth(o.v)}
                      className={cn(
                        "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                        readingWidth === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Caps the text column at roughly that many characters per line. A pane
                  already narrower than the measure is left alone, so in Split view on a
                  narrow window this may have no visible effect.
                </p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-focus" className="text-sm">Focus mode</Label>
                  <p className="text-xs text-muted-foreground">Dim the menus, toolbar, and status bar so the document leads.</p>
                </div>
                <Switch id="pref-focus" checked={focusMode} onCheckedChange={setFocusMode} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-spellcheck" className="text-sm">Spellcheck</Label>
                  <p className="text-xs text-muted-foreground">Browser spellcheck squiggles in both panes.</p>
                </div>
                <Switch id="pref-spellcheck" checked={spellcheck} onCheckedChange={setSpellcheck} />
              </div>
            </section>

            {/* Admin — debugging / operator modules, separate from everyday
                settings. Hidden from users (A081): shown in development builds,
                or in a browser opted in with localStorage["pf:admin"] = "1". */}
            {showAdmin && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Admin
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-context-menu" className="text-sm">Enable right-click menu</Label>
                  <p className="text-xs text-muted-foreground">Custom editor context menu; off falls back to the browser menu.</p>
                </div>
                <Switch id="pref-context-menu" checked={contextMenuEnabled} onCheckedChange={setContextMenuEnabled} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-console" className="text-sm">Diagnostics console</Label>
                  <p className="text-xs text-muted-foreground">Adds a read-only console tab to the bottom tray (lifecycle, storage, links).</p>
                </div>
                <Switch id="pref-console" checked={consoleEnabled} onCheckedChange={setConsoleEnabled} />
              </div>
              {adsAvailable() && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="pref-ads" className="text-sm">Show ads</Label>
                    <p className="text-xs text-muted-foreground">Placeholder ad slots for layout work — development builds only; never shown in embeds.</p>
                  </div>
                  <Switch id="pref-ads" checked={showAds} onCheckedChange={setShowAds} />
                </div>
              )}
            </section>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// Memoized: this stays MOUNTED while closed so its sheet/dialog can animate
// out, and without a memo it re-ran its whole body — and, for the settings
// sheet, ~26 store subscriptions — on every render of the editor shell,
// i.e. on every keystroke, to produce a tree nobody was looking at.
export const SettingsSheet = React.memo(SettingsSheetInner);
