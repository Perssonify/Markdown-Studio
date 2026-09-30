import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Check, Copy } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { APP_NAME } from "../constants";
import { PALETTES } from "../theme/palette";
import { adsAvailable } from "../utils/build-gates";
import { useT } from "../i18n";

type ViewMode = "split" | "md" | "html";
type ThemeOpt = "light" | "dark";
type ChromeOpt = "full" | "minimal" | "none";
type BoolOpt = "true" | "false";
type BgMode = "transparent" | "custom";
type AccentMode = "palette" | "custom";

/** Which URL parameters are toggled ON (included in the generated links). */
type ParamKey =
  | "view_mode"
  | "readonly"
  | "ads"
  | "import_url"
  | "theme"
  | "accent"
  | "chrome"
  | "bg";

/**
 * The app lives at the site ROOT — `/about`, `/help` and `/graph` are real
 * routes (see `app/router.tsx`). Composing a share link from the CURRENT
 * pathname therefore produced `/help?view_mode=md`, which opens the Help page
 * rather than the editor: the recipient never saw the settings the link was
 * built to carry. Always target the app root.
 */
function appBase(): { origin: string; root: string } {
  if (typeof window === "undefined") return { origin: "", root: "/" };
  return { origin: window.location.origin, root: "/" };
}

/** A small segmented option picker. Defined at module scope (NOT inside the
 *  builder) so it keeps a stable component identity across renders — an inner
 *  component would remount every keystroke and steal focus from sibling inputs. */
function Segmented<T extends string>({ value, onChange, options, disabled }: { value: T; onChange: (v: T) => void; options: { v: T; label: string }[]; disabled?: boolean }) {
  return (
    <div className={cn("inline-flex flex-wrap justify-end rounded-md border border-border p-0.5", disabled && "pointer-events-none opacity-40")}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** One parameter row: [enable switch] · name + scope · value selector. Module
 *  scope for the same stable-identity reason as Segmented above. */
function ParamRow({ pk, label, hint, scope, checked, onToggle, children }: {
  pk: string;
  label: string;
  hint?: string;
  scope?: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <div className="flex min-w-0 items-start gap-2">
        {/* The <Label> below names this switch (Base UI wires aria-labelledby),
            so no aria-label here — it would be dead weight the reader never hears. */}
        <Switch id={`lb-${pk}`} checked={checked} onCheckedChange={onToggle} className="mt-0.5" />
        <div className="min-w-0">
          <Label htmlFor={`lb-${pk}`} className="text-sm">
            {label}
            {scope && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">{scope}</span>}
          </Label>
          {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function OutputRow({ label, copyLabel, value, multiline, copied, onCopy }: {
  label: string;
  copyLabel: string;
  value: string;
  multiline?: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      <div className={cn("flex gap-2", multiline ? "items-start" : "items-center")}>
        <code
          className={cn(
            "min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-xs",
            multiline ? "whitespace-pre-wrap break-all" : "truncate"
          )}
          title={multiline ? undefined : value}
        >
          {value}
        </code>
        <Button size="sm" variant="secondary" onClick={onCopy} aria-label={copyLabel} title={copyLabel}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}

export interface LinkBuilderProps {
  /** `dialog` scrolls the parameter list inside a fixed-height sheet; `page`
   *  lets it flow, for the Help page where there is room. */
  variant?: "dialog" | "page";
  className?: string;
}

/**
 * Shareable-link / embed-snippet builder.
 *
 * Every URL parameter the product understands gets an explicit **enable**
 * switch plus a selector of its allowed values, so a generated link carries
 * exactly the settings you turned on and nothing else. Parameters an audience
 * cannot act on are left out of the relevant output automatically (import_url
 * is standalone-only; theme / accent / chrome / bg are embed-only).
 *
 * ONE component, rendered both in Tools ▸ Share / embed link and inline on the
 * Help page. Help used to carry its own cut-down builder that could only
 * produce `?import_url=` links, so the two surfaces disagreed about what the
 * product supports; the reference documentation sat beside a widget that could
 * not construct most of what it documented.
 */
export function LinkBuilder({ variant = "dialog", className }: LinkBuilderProps) {
  const t = useT();
  // Which params are enabled (written into the links).
  const [on, setOn] = useState<Record<ParamKey, boolean>>({
    view_mode: false, readonly: false, ads: false, import_url: false,
    theme: false, accent: false, chrome: false, bg: false,
  });
  const toggle = (k: ParamKey) => (v: boolean) => setOn((s) => ({ ...s, [k]: v }));

  // Per-param values.
  const [viewMode, setViewMode] = useState<ViewMode>("split");
  const [readonly, setReadonly] = useState<BoolOpt>("true");
  const [ads, setAds] = useState<BoolOpt>("true");
  const [importUrl, setImportUrl] = useState("");
  const [theme, setTheme] = useState<ThemeOpt>("dark");
  const [accentMode, setAccentMode] = useState<AccentMode>("palette");
  const [accent, setAccent] = useState<string>(PALETTES[0]?.id ?? "amber");
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [chrome, setChrome] = useState<ChromeOpt>("full");
  const [bgMode, setBgMode] = useState<BgMode>("transparent");
  const [bgColor, setBgColor] = useState("#ffffff");

  const [copied, setCopied] = useState<"app" | "embed" | null>(null);

  const { origin, root } = appBase();

  const bgValue = bgMode === "transparent" ? "transparent" : bgColor.trim();
  const importTrimmed = importUrl.trim();

  // The `ads` parameter only exists in development builds (A078): production
  // ignores it, so offering it here would build links that do nothing — or, in
  // a dev build shared by mistake, links that dress the product in placeholder
  // ad slots.
  const showAdsParam = adsAvailable();
  const adsOn = showAdsParam && on.ads;

  const { appUrl, embedSnippet } = useMemo(() => {
    // Standalone link — only the params the standalone app actually reads.
    const app = new URLSearchParams();
    if (on.view_mode) app.set("view_mode", viewMode);
    if (on.readonly) app.set("readonly", readonly);
    if (adsOn) app.set("ads", ads);
    if (on.import_url && importTrimmed) app.set("import_url", importTrimmed);
    const appQs = app.toString();
    const appUrl = `${origin}${root}${appQs ? `?${appQs}` : ""}`;

    // Embed iframe — the standalone params minus import_url (top-level only) plus
    // the embed-only presentation params.
    const emb = new URLSearchParams();
    if (on.view_mode) emb.set("view_mode", viewMode);
    if (on.readonly) emb.set("readonly", readonly);
    if (adsOn) emb.set("ads", ads);
    if (on.theme) emb.set("theme", theme);
    if (on.accent) {
      if (accentMode === "palette") emb.set("accent", accent);
      else emb.set("accentColor", accentColor);
    }
    if (on.chrome) emb.set("chrome", chrome);
    if (on.bg && bgValue) emb.set("bg", bgValue);
    const embQs = emb.toString();
    const embedUrl = `${origin}${root}embed.html${embQs ? `?${embQs}` : ""}`;
    const embedSnippet = `<iframe src="${embedUrl}" width="100%" height="600" style="border:0" title="${APP_NAME}"></iframe>`;
    return { appUrl, embedSnippet };
  }, [origin, root, on, adsOn, viewMode, readonly, ads, importTrimmed, theme, accentMode, accent, accentColor, chrome, bgValue]);

  const copy = async (text: string, which: "app" | "embed") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
    } catch {
      /* clipboard blocked — the value is on screen for manual copy */
    }
  };

  const anyOn = Object.values(on).some(Boolean);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        className={cn(
          "space-y-3",
          variant === "dialog" && "max-h-[46dvh] overflow-y-auto pr-1"
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("dialogs.linkAndEmbed")}</p>
          {anyOn && (
            <button
              type="button"
              onClick={() => setOn({ view_mode: false, readonly: false, ads: false, import_url: false, theme: false, accent: false, chrome: false, bg: false })}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t("dialogs.turnAllOff")}
            </button>
          )}
        </div>

        <ParamRow pk="view_mode" label={t("dialogs.viewMode")} hint="view_mode=md | html | split" checked={on.view_mode} onToggle={toggle("view_mode")}>
          <Segmented disabled={!on.view_mode} value={viewMode} onChange={setViewMode} options={[{ v: "split", label: t("dialogs.modeSplit") }, { v: "md", label: t("dialogs.modeMarkdown") }, { v: "html", label: t("dialogs.modeRich") }]} />
        </ParamRow>
        <ParamRow pk="readonly" label={t("dialogs.readOnly")} hint={t("dialogs.readonlyTrueEditingOffView")} checked={on.readonly} onToggle={toggle("readonly")}>
          <Segmented disabled={!on.readonly} value={readonly} onChange={setReadonly} options={[{ v: "true", label: t("dialogs.on") }, { v: "false", label: t("dialogs.off") }]} />
        </ParamRow>
        {showAdsParam && (
          <ParamRow pk="ads" label={t("dialogs.ads")} scope={t("dialogs.scopeDevOnly")} hint={t("dialogs.adsTrueShowThePlaceholder")} checked={on.ads} onToggle={toggle("ads")}>
            <Segmented disabled={!on.ads} value={ads} onChange={setAds} options={[{ v: "true", label: t("dialogs.on") }, { v: "false", label: t("dialogs.off") }]} />
          </ParamRow>
        )}
        <ParamRow
          pk="import_url"
          label={t("dialogs.importUrl")}
          scope={t("dialogs.scopeLinkOnly")}
          hint={t("dialogs.importUrlPreFillsThe")}
          checked={on.import_url}
          onToggle={toggle("import_url")}
        >
          <Input
            disabled={!on.import_url}
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder={t("dialogs.importUrlPlaceholder")}
            className="h-8 w-[min(220px,45vw)] text-xs"
            inputMode="url"
            aria-label={t("dialogs.sourceUrlToPreFill")}
          />
        </ParamRow>

        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("dialogs.embedOnly")}</p>
        <ParamRow pk="theme" label={t("dialogs.theme")} scope={t("dialogs.scopeEmbed")} hint="theme=light | dark" checked={on.theme} onToggle={toggle("theme")}>
          <Segmented disabled={!on.theme} value={theme} onChange={setTheme} options={[{ v: "light", label: t("dialogs.themeLight") }, { v: "dark", label: t("dialogs.themeDark") }]} />
        </ParamRow>
        <ParamRow pk="accent" label={t("dialogs.accent")} scope={t("dialogs.scopeEmbed")} hint={t("dialogs.accentPaletteOrAccentcolorCss")} checked={on.accent} onToggle={toggle("accent")}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Segmented disabled={!on.accent} value={accentMode} onChange={setAccentMode} options={[{ v: "palette", label: t("dialogs.palette") }, { v: "custom", label: t("dialogs.color") }]} />
            {accentMode === "palette" ? (
              <select
                disabled={!on.accent}
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                aria-label={t("dialogs.accentPalette")}
                className={cn("h-8 rounded-md border border-border bg-background px-2 text-xs", !on.accent && "opacity-40")}
              >
                {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            ) : (
              <input
                type="color"
                disabled={!on.accent}
                value={/^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : "#f59e0b"}
                onChange={(e) => setAccentColor(e.target.value)}
                className={cn("h-8 w-9 cursor-pointer rounded-md border border-border bg-background p-0.5", !on.accent && "opacity-40")}
                aria-label={t("dialogs.accentColor")}
              />
            )}
          </div>
        </ParamRow>
        <ParamRow pk="chrome" label={t("dialogs.chrome")} scope={t("dialogs.scopeEmbed")} hint="chrome=full | minimal | none" checked={on.chrome} onToggle={toggle("chrome")}>
          <Segmented disabled={!on.chrome} value={chrome} onChange={setChrome} options={[{ v: "full", label: t("dialogs.chromeFull") }, { v: "minimal", label: t("dialogs.chromeMinimal") }, { v: "none", label: t("dialogs.chromeNone") }]} />
        </ParamRow>
        <ParamRow pk="bg" label={t("dialogs.background")} scope={t("dialogs.scopeEmbed")} hint={t("dialogs.bgTransparentCssColor")} checked={on.bg} onToggle={toggle("bg")}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Segmented disabled={!on.bg} value={bgMode} onChange={setBgMode} options={[{ v: "transparent", label: t("dialogs.transparent") }, { v: "custom", label: t("dialogs.color") }]} />
            {bgMode === "custom" && (
              <input
                type="color"
                disabled={!on.bg}
                value={/^#[0-9a-fA-F]{6}$/.test(bgColor) ? bgColor : "#ffffff"}
                onChange={(e) => setBgColor(e.target.value)}
                className={cn("h-8 w-9 cursor-pointer rounded-md border border-border bg-background p-0.5", !on.bg && "opacity-40")}
                aria-label={t("dialogs.backgroundColor")}
              />
            )}
          </div>
        </ParamRow>
      </div>

      <div className="space-y-3 border-t border-border pt-3">
        <OutputRow label={t("dialogs.standaloneLink")} copyLabel={t("dialogs.copyStandaloneLink")} value={appUrl} copied={copied === "app"} onCopy={() => copy(appUrl, "app")} />
        <OutputRow label={t("dialogs.embedSnippet")} copyLabel={t("dialogs.copyEmbedSnippet")} value={embedSnippet} multiline copied={copied === "embed"} onCopy={() => copy(embedSnippet, "embed")} />
      </div>
    </div>
  );
}
