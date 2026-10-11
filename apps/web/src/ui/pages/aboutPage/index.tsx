import { FileText, Heart, Shield, WifiOff } from "lucide-react";
import { APP_BRAND, APP_DOMAIN, APP_NAME, APP_URL, VERSION } from "@/constants";
import { CREDITS, LICENSE_SUMMARY, THIRD_PARTY_NOTICES_PATH } from "@/data/credits";
import { PageChrome } from "../pageChrome";
import { CopyDiagnosticsButton } from "@/ui/diagnostics/diagnosticsActions";
import { localizedContent, renderRich, useT } from "@/i18n";
import { ABOUT_CONTENT } from "./about-content";

interface AboutPageProps {
  onClose: () => void;
}

function Highlight({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-card/40 p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" />
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function AboutPage({ onClose }: AboutPageProps) {
  const t = useT();
  // Prose is content, one version per language (about-content.ts).
  const copy = localizedContent(ABOUT_CONTENT);
  return (
    <PageChrome title={t("pages.aboutTitle", { app: APP_NAME })} onClose={onClose}>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        {/* Hero */}
        <div className="flex flex-col items-center text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 shadow-sm shadow-primary/20">
            <FileText className="size-7 text-primary" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t.rich("pages.aboutVersion", { version: VERSION, b: (s) => <span className="font-medium">{s}</span>, brand: APP_BRAND })}
          </p>
          <p className="mt-4 inline-flex items-center gap-1.5 text-base font-medium">
            {t.rich("pages.madeWith", { heart: <Heart className="size-4 fill-rose-500 text-rose-500" aria-label={t("pages.love")} /> })}
          </p>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {copy.intro}
          </p>
          <a
            href={APP_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-3 text-sm font-medium text-primary-strong hover:underline"
          >
            {APP_DOMAIN}
          </a>
        </div>

        {/* Principles */}
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          <Highlight icon={Shield} title={copy.principles.privacy.title}>
            {copy.principles.privacy.body}
          </Highlight>
          <Highlight icon={WifiOff} title={copy.principles.offline.title}>
            {copy.principles.offline.body}
          </Highlight>
          <Highlight icon={FileText} title={copy.principles.formats.title}>
            {copy.principles.formats.body}
          </Highlight>
        </div>

        {/* Credits */}
        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-tight">{t("pages.builtWithOpenSource")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {renderRich(copy.creditsIntro, {
              app: APP_NAME,
              licenses: LICENSE_SUMMARY.join(" · "),
              b: (s) => <span className="font-medium text-foreground">{s}</span>,
            })}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {renderRich(copy.creditsNote, {
              link: (s) => (
                <a
                  href={THIRD_PARTY_NOTICES_PATH}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary-strong hover:underline"
                >
                  {s}
                </a>
              ),
            })}
          </p>

          <div className="mt-6 space-y-8">
            {CREDITS.map((group) => (
              <div key={group.group}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.group}
                </h3>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[340px] text-left text-xs">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t("pages.creditsPackage")}</th>
                        <th className="hidden px-3 py-2 font-medium sm:table-cell">{t("pages.creditsUsedFor")}</th>
                        <th className="px-3 py-2 font-medium">{t("pages.creditsVersion")}</th>
                        <th className="px-3 py-2 font-medium">{t("pages.creditsLicense")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item, i) => (
                        <tr key={item.name} className={i % 2 ? "bg-card/30" : ""}>
                          <td className="px-3 py-2 font-mono text-[11px] text-foreground">{item.name}</td>
                          <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{item.role ?? "—"}</td>
                          <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">{item.version}</td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {item.license}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Report a problem — the diagnostics report is privacy-safe (event
            types, versions, browser; never document content), so it can be
            pasted into a support request as-is (utils/diagnostics.ts, A009). */}
        <section className="mt-12">
          <h2 className="text-lg font-semibold tracking-tight">{t("pages.somethingNotWorking")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {copy.diagnostics}
          </p>
          <CopyDiagnosticsButton className="mt-3" />
        </section>

        <footer className="mt-12 border-t border-border pt-6 text-center text-xs text-muted-foreground">
          {renderRich(copy.footer, { app: APP_NAME })}
          <span className="mt-2 block">
            <a href={THIRD_PARTY_NOTICES_PATH} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
              {t("pages.thirdPartyLicences")}
            </a>
          </span>
        </footer>
      </div>
    </PageChrome>
  );
}
