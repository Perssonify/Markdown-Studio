import { useId } from "react";
import { Label } from "@/components/ui/label";
import { availableLocales, setLocale, useLocale, useT } from "../i18n";

/**
 * Settings ▸ Appearance ▸ Language (A099). Rendered only when this build can
 * show more than one language — in production today that is English alone, so
 * the row is absent; development builds add the `en-XA` pseudo-locale.
 *
 * Each language is listed by its own name (an autonym), not translated: a
 * reader looking for their language finds it in their language. Choosing one
 * is remembered (`pf:locale`) and applies at once, without a reload.
 */
export function LanguageSetting() {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const locales = availableLocales();
  if (locales.length < 2) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {t("settings.language")}
      </Label>
      <select
        id={id}
        value={locale}
        onChange={(e) => setLocale(e.target.value)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {locales.map((l) => (
          <option key={l.id} value={l.id} lang={l.id}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
