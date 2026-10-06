import { Button } from "@/components/ui/button";
import { LogIn, LogOut } from "lucide-react";
import { useState } from "react";
import { useAccount } from "../../app/account";
import { AccountAvatar } from "../../app/AccountAvatar";
import { AccountBackups } from "../../app/AccountBackups";
import { CloudStatusLine } from "../../app/CloudStatusLine";
import { PlansSection } from "../../app/PlansSection";
import { backUpNow, libraryOwner, useCloudStatus } from "../../app/cloud";
import { useLocale, useT } from "../../i18n";
import { PageChrome } from "./PageChrome";

interface ProfilePageProps {
  onClose: () => void;
  onSignIn: () => void;
}

function formatDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(d);
  } catch {
    return d.toDateString();
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-3 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * /profile — who is signed in, and Sign out. After signing out the page shows
 * the signed-out state (with Sign in) rather than leaving, so the result of
 * the click is visible where it was made.
 */
export function ProfilePage({ onClose, onSignIn }: ProfilePageProps) {
  const t = useT();
  const locale = useLocale();
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const signOut = useAccount((s) => s.signOut);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const cloudPhase = useCloudStatus((s) => s.phase);

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutFailed(false);
    try {
      await signOut();
    } catch {
      setSignOutFailed(true);
    } finally {
      setSigningOut(false);
    }
  };

  let body: React.ReactNode;
  if (status === "loading") {
    body = <p className="text-center text-sm text-muted-foreground">{t("account.checking")}</p>;
  } else if (status === "unavailable") {
    body = (
      <div className="space-y-2 text-center" role="status">
        <p className="text-sm font-medium">{t("account.unavailable")}</p>
        <p className="text-sm text-muted-foreground">{t("account.unavailableHint")}</p>
      </div>
    );
  } else if (status === "signed-in" && user) {
    const since = formatDate(user.createdAt, locale);
    body = (
      <>
        <div className="flex flex-col items-center text-center">
          <AccountAvatar user={user} className="size-16 text-xl shadow-sm shadow-primary/20 ring-4 ring-primary/10" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{user.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
          <CloudStatusLine className="mt-3 justify-center" />
        </div>
        <dl className="mt-8 rounded-lg border border-border bg-card/40 px-4">
          <Row label={t("account.nameLabel")} value={user.name} />
          <Row label={t("account.emailLabel")} value={user.email} />
          <Row label={t("account.signedInWithLabel")} value={t("account.google")} />
          {since && <Row label={t("account.memberSinceLabel")} value={since} />}
        </dl>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("account.documentsNote")}</p>
        {/* Only the account this browser's library syncs with: backing up
            another account's library into this one would mix the two. */}
        {cloudPhase !== "blocked" && libraryOwner() === user.id && <AccountBackups backUpNow={() => backUpNow(user.id)} />}
        <div className="mt-10 flex flex-col items-center gap-2 border-t border-border pt-6">
          <Button variant="outline" className="gap-2" disabled={signingOut} onClick={handleSignOut}>
            <LogOut className="size-4" />
            {signingOut ? t("account.signingOut") : t("account.signOut")}
          </Button>
          {signOutFailed && (
            <p role="alert" className="text-sm text-destructive">
              {t("account.signOutFailed")}
            </p>
          )}
        </div>
      </>
    );
  } else {
    body = (
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm font-medium">{t("account.notSignedIn")}</p>
        <p className="text-sm text-muted-foreground">{t("account.notSignedInHint")}</p>
        <Button className="mt-2 gap-2" onClick={onSignIn}>
          <LogIn className="size-4" />
          {t("account.signIn")}
        </Button>
      </div>
    );
  }

  return (
    <PageChrome title={t("account.profileTitle")} onClose={onClose}>
      <div className="mx-auto max-w-xl px-4 py-8 sm:px-8 sm:py-10">
        {body}
        <PlansSection />
      </div>
    </PageChrome>
  );
}
