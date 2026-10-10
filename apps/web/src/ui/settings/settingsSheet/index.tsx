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
} from "@/store/preferences/settings";
import { useUIStore } from "@/store/preferences/uiStore";
import { MODES } from "@/constants";
import { adminSettingsAvailable, adsAvailable } from "@/utils/build-gates";
import { PrivacySection } from "../settingsPrivacy";
import { StorageBackupSection, StoredImagesSection } from "../settingsStorage";
import { AccentCircleRow, ThemeCircleRow } from "../themeControls";
import { EraseLocalDataSection } from "../eraseLocalData";
import { LanguageSetting } from "../languageSetting";
import { t, useT } from "@/i18n";

const FLAVORS: { id: MarkdownFlavor; label: string; desc: string }[] = [
  {
    id: "commonmark",
    get label() { return t("settings.flavorCommonmark"); },
    get desc() { return t("settings.flavorCommonmarkDesc"); },
  },
  {
    id: "gfm",
    get label() { return t("settings.flavorGfm"); },
    get desc() { return t("settings.flavorGfmDesc"); },
  },
  { id: "markdown-extra", get label() { return t("settings.flavorMarkdownExtra"); }, get desc() { return t("settings.flavorMarkdownExtraDesc"); } },
];

const CORE_TOGGLES: { key: keyof MarkdownFeatureSettings; label: string }[] = [
  { key: "tables", get label() { return t("settings.featureTables"); } },
  { key: "taskLists", get label() { return t("settings.featureTaskLists"); } },
  { key: "strikethrough", get label() { return t("settings.featureStrikethrough"); } },
  { key: "autolink", get label() { return t("settings.featureAutolink"); } },
  { key: "footnotes", get label() { return t("settings.featureFootnotes"); } },
];

const RICH_TOGGLES: { key: keyof MarkdownFeatureSettings; label: string }[] = [
  { key: "math", get label() { return t("settings.extensionMath"); } },
  { key: "diagrams", get label() { return t("settings.extensionDiagrams"); } },
  { key: "music", get label() { return t("settings.extensionMusic"); } },
  { key: "emoji", get label() { return t("settings.extensionEmoji"); } },
  { key: "callouts", get label() { return t("settings.extensionCallouts"); } },
  { key: "details", get label() { return t("settings.extensionDetails"); } },
];

function SettingsSheetInner({
  open,
  onOpenChange,
  onBackup,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  /** Run the full, restorable backup (shown in Storage & backup when given). */
  onBackup?: () => void;
}) {
  const t = useT();
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
          <SheetTitle>{t("common.settings")}</SheetTitle>
          <SheetDescription>
            {t("settings.appearanceAndMarkdownPreferencesSaved")}
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <ScrollArea className="h-[calc(100dvh-5.5rem)]">
          <div className="space-y-6 px-5 py-4">
            {/* Appearance — theme + accent, mirrored in the View ▸ Appearance menu */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("settings.appearance")}
              </h3>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("settings.theme")}</Label>
                <ThemeCircleRow />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("settings.accent")}</Label>
                <AccentCircleRow />
              </div>
              <LanguageSetting />
            </section>

            <Separator />

            {/* Markdown flavor */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("settings.markdownFlavor")}
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
                {t("settings.features")}
              </h3>
              {CORE_TOGGLES.map((feature) => (
                <div key={feature.key} className="flex items-center justify-between">
                  <Label htmlFor={`feat-${feature.key}`} className="text-sm">
                    {feature.label}
                  </Label>
                  <Switch
                    id={`feat-${feature.key}`}
                    checked={Boolean(markdownFeatures[feature.key])}
                    onCheckedChange={toggle(feature.key)}
                  />
                </div>
              ))}
            </section>

            <Separator />

            {/* Rich renderers */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("settings.extensions")}
              </h3>
              {RICH_TOGGLES.map((feature) => (
                <div key={feature.key} className="flex items-center justify-between">
                  <Label htmlFor={`feat-${feature.key}`} className="text-sm">
                    {feature.label}
                  </Label>
                  <Switch
                    id={`feat-${feature.key}`}
                    checked={Boolean(markdownFeatures[feature.key])}
                    onCheckedChange={toggle(feature.key)}
                  />
                </div>
              ))}
            </section>

            <Separator />

            {/* Editor behaviour */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("settings.editor")}
              </h3>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("settings.viewMode")}</Label>
                <div className={cn("inline-flex w-full rounded-md border border-border p-0.5", readOnly && "opacity-50")}>
                  {[
                    { v: MODES.MD, label: t("settings.viewMarkdown") },
                    { v: MODES.HTML, label: t("settings.viewRichText") },
                    { v: MODES.SPLIT, label: t("settings.viewSplit") },
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
                  <p className="text-[11px] text-muted-foreground">{t("settings.viewIsLockedWhileRead")}</p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-readonly" className="text-sm">{t("settings.readOnlyMode")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.disableEditingHideTheFormatting")}</p>
                </div>
                <Switch id="pref-readonly" checked={readOnly} onCheckedChange={setReadOnly} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-shortcuts" className="text-sm">{t("settings.keyboardShortcuts")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.turnOffAllAppKeyboard")}</p>
                </div>
                <Switch id="pref-shortcuts" checked={keyboardShortcutsEnabled} onCheckedChange={setKeyboardShortcutsEnabled} />
              </div>
            </section>

            <Separator />

            {/* Reading & typography — applied as CSS vars on the editor container
                so both panes honor them; all sticky via localStorage. */}
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("settings.readingAndTypography")}
              </h3>
              <div className="space-y-1.5">
                <Label className="text-sm">{t("settings.fontSize")}</Label>
                <div className="inline-flex w-full rounded-md border border-border p-0.5">
                  {[
                    { v: 13, label: t("settings.fontSizeS") },
                    { v: 15, label: t("settings.fontSizeM") },
                    { v: 17, label: t("settings.fontSizeL") },
                    { v: 19, label: t("settings.fontSizeXl") },
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
                <Label className="text-sm">{t("settings.lineHeight")}</Label>
                <div className="inline-flex w-full rounded-md border border-border p-0.5">
                  {[
                    { v: 1.4, label: t("settings.lineHeightTight") },
                    { v: 1.6, label: t("settings.lineHeightNormal") },
                    { v: 1.8, label: t("settings.lineHeightRelaxed") },
                    { v: 2.1, label: t("settings.lineHeightLoose") },
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
                <Label className="text-sm">{t("settings.readingWidth")}</Label>
                <div className="inline-flex w-full rounded-md border border-border p-0.5">
                  {/* Characters, not pixels. A reading measure IS a character
                      count, so it must scale with the font-size preference —
                      and as a pixel cap on the container wrapping both panes,
                      "Narrow" only began to bind above a ~1620px viewport, so
                      in the default split layout every option was identical
                      while the control still highlighted and persisted. */}
                  {[
                    { v: 0, label: t("settings.readingWidthFull") },
                    { v: 65, label: t("settings.readingWidthNarrow") },
                    { v: 80, label: t("settings.readingWidthMedium") },
                    { v: 100, label: t("settings.readingWidthWide") },
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
                  {t("settings.readingWidthHint")}
                </p>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-focus" className="text-sm">{t("settings.focusMode")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.dimTheMenusToolbarAnd")}</p>
                </div>
                <Switch id="pref-focus" checked={focusMode} onCheckedChange={setFocusMode} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-spellcheck" className="text-sm">{t("settings.spellcheck")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.browserSpellcheckSquigglesInBoth")}</p>
                </div>
                <Switch id="pref-spellcheck" checked={spellcheck} onCheckedChange={setSpellcheck} />
              </div>
            </section>

            <Separator />

            {/* Storage & backup (SettingsStorage.tsx), then Privacy (SettingsPrivacy.tsx). */}
            <StorageBackupSection open={open} onBackup={onBackup} />
            <StoredImagesSection open={open} />

            <Separator />

            <PrivacySection open={open} />

            {/* Admin — debugging / operator modules, separate from everyday
                settings. Hidden from users (A081): shown in development builds,
                or in a browser opted in with localStorage["pf:admin"] = "1". */}
            {showAdmin && (
            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t("settings.admin")}
              </h3>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-context-menu" className="text-sm">{t("settings.enableRightClickMenu")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.customEditorContextMenuOff")}</p>
                </div>
                <Switch id="pref-context-menu" checked={contextMenuEnabled} onCheckedChange={setContextMenuEnabled} />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="pref-console" className="text-sm">{t("settings.diagnosticsConsole")}</Label>
                  <p className="text-xs text-muted-foreground">{t("settings.addsAReadOnlyConsole")}</p>
                </div>
                <Switch id="pref-console" checked={consoleEnabled} onCheckedChange={setConsoleEnabled} />
              </div>
              {adsAvailable() && (
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="pref-ads" className="text-sm">{t("settings.showAds")}</Label>
                    <p className="text-xs text-muted-foreground">{t("settings.placeholderAdSlotsForLayout")}</p>
                  </div>
                  <Switch id="pref-ads" checked={showAds} onCheckedChange={setShowAds} />
                </div>
              )}
            </section>
            )}

            {/* Local data — erase everything the editor keeps in this browser
                (its own section, last; see EraseLocalData.tsx). */}
            <EraseLocalDataSection />
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
