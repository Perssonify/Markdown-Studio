import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";
import { useSyncExternalStore } from "react";
import { APP_NAME } from "@/constants";
import { useT } from "@/i18n";
import {
  analyticsConsent,
  consentPromptNeeded,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
} from "@/utils/analytics-consent";

/**
 * The analytics consent prompt, for every visitor in every country
 * (utils/analytics-consent.ts): under the editor's header, and under the
 * header of each interior page (PageChrome), which covers the editor's copy.
 * Until it is answered, gtag.js sets no cookies. A bar rather than a dialog:
 * the page stays usable, and "Decline" is exactly as prominent as "Allow".
 * Gone for good once answered; Settings ▸ Privacy changes the answer.
 */
export function AnalyticsConsentBar() {
  const t = useT();
  const consent = useSyncExternalStore(subscribeAnalyticsConsent, analyticsConsent);
  if (consent !== null || !consentPromptNeeded()) return null;

  return (
    <div
      role="region"
      aria-label={t("notices.analyticsConsentLabel")}
      className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-sm"
      data-print-hide
    >
      <BarChart3 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {/* The basis wraps the buttons onto their own line on a phone, instead
          of squeezing the text into a narrow column beside them. */}
      <p className="min-w-0 flex-1 basis-72 text-muted-foreground">{t("notices.analyticsConsent", { app: APP_NAME })}</p>
      <div className="ml-auto flex shrink-0 gap-2">
        <Button size="sm" variant="outline" className="h-7" onClick={() => setAnalyticsConsent("granted")}>
          {t("notices.analyticsAllow")}
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={() => setAnalyticsConsent("denied")}>
          {t("notices.analyticsDecline")}
        </Button>
      </div>
    </div>
  );
}
