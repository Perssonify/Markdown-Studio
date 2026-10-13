import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useAccount } from "@/app/account/account";
import { AccountAvatar } from "@/app/account/accountAvatar";
import { APP_BRAND, APP_NAME } from "@/constants";
import { useT } from "@/i18n";
import { PageChrome } from "../pageChrome";

/** The Markdown Studio logo. Decorative: the heading beside it names the app. */
function BrandLogo() {
  return <img src="/brand/markdown.webp" alt="" width={80} height={80} className="mx-auto size-20" />;
}

interface SignInPanelProps {
  /** Shown to a visitor who is already signed in (the /login page only). */
  onClose?: () => void;
  onProfile?: () => void;
  /** When false, the brand icon + heading are omitted so a host layout (the
   * sign-in screen) can supply its own. The interactive body is unchanged. */
  showHeader?: boolean;
}

/** Google's "G" mark, in its own colours (it is the provider's brand, so it is not themed). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="size-4 shrink-0">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}

/** The error code Better Auth appends when it sends a failed sign-in back here. */
function readReturnedError(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("error");
  } catch {
    return null;
  }
}

/**
 * The sign-in content: Google, and what each account state means. Better Auth
 * returns a failed attempt to /login with `?error=<code>`: shown once, then
 * removed from the address bar.
 */
export function SignInPanel({ onClose, onProfile, showHeader = true }: SignInPanelProps) {
  const t = useT();
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const signIn = useAccount((s) => s.signIn);
  const [returnedError] = useState(readReturnedError);
  const [starting, setStarting] = useState(false);
  const [startFailed, setStartFailed] = useState(false);

  useEffect(() => {
    if (!returnedError) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("error");
      url.searchParams.delete("error_description");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch {
      /* the message is shown either way */
    }
  }, [returnedError]);

  const start = async () => {
    setStarting(true);
    setStartFailed(false);
    try {
      await signIn(); // the page leaves for Google
    } catch {
      setStarting(false);
      setStartFailed(true);
    }
  };

  let body: React.ReactNode;
  if (status === "loading") {
    body = <p className="mt-6 text-sm text-muted-foreground">{t("account.checking")}</p>;
  } else if (status === "unavailable") {
    body = (
      <div className="mt-6 space-y-2" role="status">
        <p className="text-sm font-medium">{t("account.unavailable")}</p>
        <p className="text-sm text-muted-foreground">{t("account.unavailableHint")}</p>
      </div>
    );
  } else if (status === "signed-in" && user) {
    body = (
      <div className="mt-6 flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <AccountAvatar user={user} className="size-10 text-sm" />
          <p className="text-sm">{t("account.alreadySignedIn", { name: user.name })}</p>
        </div>
        <div className="flex gap-2">
          {onProfile && <Button onClick={onProfile}>{t("account.viewProfile")}</Button>}
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              {t("account.backToEditor")}
            </Button>
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="mt-6 flex w-full flex-col items-stretch gap-3">
        <p className="text-sm leading-relaxed text-muted-foreground">{t("account.loginLead")}</p>
        <Button size="lg" variant="outline" className="mt-2 h-11 gap-2.5 text-sm" disabled={starting} onClick={start}>
          <GoogleMark />
          {starting ? t("account.openingGoogle") : t("account.continueWithGoogle")}
        </Button>
        {(startFailed || returnedError) && (
          <p role="alert" className="text-sm text-destructive">
            {startFailed ? t("account.signInCouldNotStart") : t("account.signInDidNotComplete", { code: returnedError ?? "" })}
          </p>
        )}
      </div>
    );
  }

  // Embedded in a custom layout (the sign-in screen) that supplies its own brand.
  if (!showHeader) return <div className="w-full text-center">{body}</div>;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center px-4 py-14 text-center sm:py-20">
      <BrandLogo />
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{t("account.loginHeading", { app: APP_NAME })}</h1>
      {body}
    </div>
  );
}

/**
 * /login: an interior page over the (still-mounted) editor. Signed out, the
 * full sign-in screen; signed in, or with no account service, the panel that
 * says so.
 */
export function LoginPage({ onClose, onProfile }: { onClose: () => void; onProfile: () => void }) {
  const t = useT();
  const status = useAccount((s) => s.status);
  return (
    <PageChrome title={t("account.loginTitle")} onClose={onClose}>
      {status === "signed-out" ? <SignInScreen onContinue={onClose} /> : <SignInPanel onClose={onClose} onProfile={onProfile} />}
    </PageChrome>
  );
}

/**
 * The sign-in screen. Signing in is optional: the editor works without an
 * account, with the notes kept in this browser; signing in adds sync and the
 * daily backup. So the screen always offers a way back ("Continue without
 * signing in"). A split layout: the sign-in content on the left, a photo with
 * the product's pitch on the right (hidden on narrow viewports, where the left fills).
 */
export function SignInScreen({ onContinue }: { onContinue: () => void }) {
  const t = useT();
  return (
    <div className="flex min-h-full flex-col bg-background text-foreground lg:grid lg:grid-cols-2">
      {/* Left — the sign-in content. */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm text-center">
          <BrandLogo />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("account.loginHeading", { app: APP_NAME })}</h1>
          <p className="mt-1 text-[11px] font-bold tracking-wider text-muted-foreground/60 uppercase">{APP_BRAND}</p>
          <SignInPanel showHeader={false} />
          <Button variant="ghost" size="sm" className="mt-3 text-muted-foreground" onClick={onContinue}>
            {t("account.continueWithoutSignIn")}
          </Button>
          <p className="mt-6 text-xs text-muted-foreground/70">{t("account.loginPrivacyNote")}</p>
        </div>
      </div>

      {/* Right — photo panel (desktop only). The photo is served from our own
          origin, not hot-linked, so the sign-in page makes no third-party request
          and stays inside the precache. Photo: Samuel Ramos on Unsplash
          (unsplash.com/photos/nREufpxxM8o), Unsplash License. */}
      <div className="relative hidden overflow-hidden bg-neutral-950 lg:flex lg:flex-col lg:justify-end">
        <img
          src="/images/sign-in-typewriter.webp"
          alt=""
          width={1800}
          height={1200}
          className="absolute inset-0 size-full object-cover"
        />
        <div aria-hidden className="absolute inset-0 bg-linear-to-t from-black/90 via-black/30 to-black/10" />
        <div className="relative z-10 px-12 pb-14 text-white xl:px-16 xl:pb-16">
          <span aria-hidden className="mb-5 block h-1 w-12 rounded-full bg-[#F2B035]" />
          <p className="text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">{t("account.loginTagline")}</p>
          <p className="mt-3 text-base leading-relaxed text-white/80">{t("account.loginTaglineDetail")}</p>
        </div>
      </div>
    </div>
  );
}
