import { Check, Sparkles } from "lucide-react";
import { useT, type MessageKey } from "../i18n";

const FREE_FEATURES: MessageKey[] = [
  "account.planFreeFeature1",
  "account.planFreeFeature2",
  "account.planFreeFeature3",
  "account.planFreeFeature4",
];

const PRO_FEATURES: MessageKey[] = [
  "account.planProFeature1",
  "account.planProFeature2",
  "account.planProFeature3",
  "account.planProFeature4",
];

function FeatureList({ features }: { features: MessageKey[] }) {
  const t = useT();
  return (
    <ul className="mt-4 space-y-2">
      {features.map((key) => (
        <li key={key} className="flex items-start gap-2 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
          <span>{t(key)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The account's plan, on the profile page: the Free plan every account is on
 * today, and Pro, which is on the way. Static by design — there is no billing
 * yet, so neither card has an action. Free carries a "Current plan" tag and
 * Pro a "Coming soon" one, so the page never offers an upgrade it cannot honour.
 */
export function PlansSection() {
  const t = useT();
  return (
    <section aria-labelledby="account-plans" className="mt-10">
      <h2 id="account-plans" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Sparkles className="size-5 text-primary" /> {t("account.plans")}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("account.plansHint")}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* Free — the plan every account is on today. */}
        <div className="flex flex-col rounded-lg border border-border bg-card/40 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold tracking-tight">{t("account.planFreeName")}</h3>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              {t("account.planCurrent")}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight">{t("account.planFreePrice")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("account.planFreeTagline")}</p>
          <FeatureList features={FREE_FEATURES} />
        </div>
        {/* Pro — coming soon; a teaser only until billing exists. */}
        <div className="flex flex-col rounded-lg border border-primary/40 bg-primary/[0.03] p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold tracking-tight">{t("account.planProName")}</h3>
            <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
              {t("account.planComingSoon")}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{t("account.planProTagline")}</p>
          <FeatureList features={PRO_FEATURES} />
        </div>
      </div>
    </section>
  );
}
