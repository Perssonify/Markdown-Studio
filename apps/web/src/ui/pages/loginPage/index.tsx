import { Button } from "@/components/ui/button";
import { FileText, HardDrive, RefreshCw, ShieldCheck, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount } from "@/app/account/account";
import { AccountAvatar } from "@/app/account/accountAvatar";
import { APP_BRAND, APP_NAME } from "@/constants";
import { useT, type MessageKey } from "@/i18n";
import { PageChrome } from "../pageChrome";

interface SignInPanelProps {
  /** Shown to a visitor who is already signed in (the /login page only). */
  onClose?: () => void;
  onProfile?: () => void;
  /** When false, the brand icon + heading are omitted so a host layout (the
   * front door) can supply its own. The interactive body is unchanged. */
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

  // Embedded in a custom layout (the front door) that supplies its own brand.
  if (!showHeader) return <div className="w-full text-center">{body}</div>;

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center px-4 py-14 text-center sm:py-20">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 shadow-sm shadow-primary/20">
        <FileText className="size-7 text-primary" />
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{t("account.loginHeading", { app: APP_NAME })}</h1>
      {body}
    </div>
  );
}

/** /login while the app is open: the panel as an interior page over the editor. */
export function LoginPage({ onClose, onProfile }: { onClose: () => void; onProfile: () => void }) {
  const t = useT();
  return (
    <PageChrome title={t("account.loginTitle")} onClose={onClose}>
      <SignInPanel onClose={onClose} onProfile={onProfile} />
    </PageChrome>
  );
}

/** What signing in gives you — shown under the button on the front door. */
const LOGIN_POINTS: { key: MessageKey; Icon: LucideIcon }[] = [
  { key: "account.loginPointSync", Icon: RefreshCw },
  { key: "account.loginPointLocal", Icon: HardDrive },
  { key: "account.loginPointPrivate", Icon: ShieldCheck },
];

/**
 * The front door: what a signed-out visitor sees INSTEAD of the app (App.tsx,
 * at /login). No way past it but signing in — there is no editor behind it to
 * go back to. A split layout: the sign-in content on the left, a branded image
 * panel on the right (hidden on narrow viewports, where the left fills).
 */
export function SignInScreen() {
  const t = useT();
  return (
    <main className="flex min-h-dvh flex-col bg-background text-foreground lg:grid lg:grid-cols-2">
      {/* Left — the sign-in content. */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 shadow-sm shadow-primary/20">
            <FileText className="size-7 text-primary" />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight">{t("account.loginHeading", { app: APP_NAME })}</h1>
          <p className="mt-1 text-[11px] font-bold tracking-wider text-muted-foreground/60 uppercase">{APP_BRAND}</p>
          <SignInPanel showHeader={false} />
          <p className="mt-8 text-xs text-muted-foreground/70">{t("account.loginPrivacyNote")}</p>
        </div>
      </div>

      {/* Right — branded image panel (desktop only). */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-primary to-primary/75 lg:flex lg:items-center lg:justify-center">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -left-16 size-120 rounded-full bg-white/10 blur-3xl" />
          <div className="absolute right-[-10%] -bottom-24 size-120 rounded-full bg-black/10 blur-3xl" />
        </div>
        <div className="relative z-10 flex max-w-md flex-col items-center px-12 text-center text-primary-foreground">
          <div className="flex items-center justify-center rounded-3xl bg-white/95 p-6 shadow-xl shadow-black/10">
            <img src="/brand/markdown.webp" alt={APP_NAME} className="h-20 w-auto" />
          </div>
          <p className="mt-8 text-2xl font-semibold tracking-tight">{t("account.loginTagline")}</p>
          <ul className="mt-8 space-y-3.5 text-left">
            {LOGIN_POINTS.map(({ key, Icon }) => (
              <li key={key} className="flex items-center gap-3 text-sm text-primary-foreground/90">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
