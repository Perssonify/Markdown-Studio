import {
  ArrowDownUp,
  FileText,
  Gem,
  HardDrive,
  History,
  RefreshCw,
  Rocket,
  Share2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useT, type MessageKey } from "@/i18n";

interface Feature {
  key: MessageKey;
  Icon: LucideIcon;
}

const FREE_FEATURES: Feature[] = [
  { key: "account.planFreeFeature1", Icon: FileText },
  { key: "account.planFreeFeature2", Icon: RefreshCw },
  { key: "account.planFreeFeature3", Icon: Share2 },
  { key: "account.planFreeFeature4", Icon: ArrowDownUp },
];

const PRO_FEATURES: Feature[] = [
  { key: "account.planProFeature1", Icon: HardDrive },
  { key: "account.planProFeature2", Icon: History },
  { key: "account.planProFeature3", Icon: Zap },
  { key: "account.planProFeature4", Icon: Rocket },
];

/**
 * One plan card. Both cards share this exact structure — title + badge row, a
 * price line, a tagline, then the feature list — so the two feature lists begin
 * at the same height and the cards read as a matched pair.
 */
function PlanCard({
  name,
  price,
  tagline,
  badge,
  features,
  highlight = false,
}: {
  name: string;
  price: string;
  tagline: string;
  badge: { label: string; solid: boolean };
  features: Feature[];
  highlight?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={`flex flex-col rounded-xl border p-5 ${highlight ? "border-primary/40 bg-primary/[0.04]" : "border-border bg-card/40"}`}
    >
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight">{name}</h3>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.solid ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}
        >
          {badge.label}
        </span>
      </div>
      <p className={`mt-3 text-2xl font-semibold tracking-tight ${highlight ? "text-muted-foreground" : "text-foreground"}`}>
        {price}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{tagline}</p>
      <ul className="mt-5 space-y-3">
        {features.map(({ key, Icon }) => (
          <li key={key} className="flex items-start gap-2.5 text-sm">
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
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
        <Gem className="size-5 text-primary" /> {t("account.plans")}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("account.plansHint")}</p>
      <div className="mt-4 grid items-stretch gap-4 sm:grid-cols-2">
        <PlanCard
          name={t("account.planFreeName")}
          price={t("account.planFreePrice")}
          tagline={t("account.planFreeTagline")}
          badge={{ label: t("account.planCurrent"), solid: false }}
          features={FREE_FEATURES}
        />
        <PlanCard
          name={t("account.planProName")}
          price={t("account.planProPrice")}
          tagline={t("account.planProTagline")}
          badge={{ label: t("account.planComingSoon"), solid: true }}
          features={PRO_FEATURES}
          highlight
        />
      </div>
    </section>
  );
}
