import { useT } from "@/i18n";

/**
 * Shown while the app asks whether the visitor is signed in (at most
 * SESSION_CHECK_TIMEOUT_MS), so the editor does not open on the wrong library
 * (signed out, or a signed-in account's) before the answer is known.
 */
export function AccountCheckScreen({ message }: { message?: string }) {
  const t = useT();
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background text-foreground" aria-busy="true">
      <p role="status" className="text-sm text-muted-foreground">
        {message ?? t("account.checking")}
      </p>
    </main>
  );
}
