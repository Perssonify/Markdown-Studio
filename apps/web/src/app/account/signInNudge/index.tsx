import { Button } from "@/components/ui/button";
import { Cloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/i18n";
import { useDocumentStore } from "@/store/documents/documentStore";
import { safeStorage } from "@/utils/safe-storage";
import { untouchedStarterIds } from "../../cloud/starters";
import { useAccount } from "../account";

const DISMISSED_KEY = "pf:sign-in-nudge-dismissed-at";
/** "Not now" keeps it away this long. */
const QUIET_MS = 7 * 24 * 60 * 60 * 1000;
/** It waits this long after the visitor's first own note, so it never interrupts the first words. */
const AFTER_MS = 60_000;

/**
 * The invitation to sign in, under the top header. Signed-out visitors use the
 * editor without an account and their notes live only in this browser; once
 * they have something of their own (a note they wrote, imported or changed,
 * not just the first-visit notes), a quiet bar offers what signing in adds:
 * sync across devices and a daily backup in the account. "Not now" hides it
 * for a week. Never shown signed in, or where no account service answers.
 */
export function SignInNudge({ onSignIn }: { onSignIn: () => void }) {
  const t = useT();
  const status = useAccount((s) => s.status);
  const documents = useDocumentStore((s) => s.documents);
  const hasOwnWork = useMemo(() => documents.length > untouchedStarterIds(documents).size, [documents]);
  const [dismissedAt, setDismissedAt] = useState(() => Number(safeStorage.get(DISMISSED_KEY)) || 0);
  const [due, setDue] = useState(false);

  useEffect(() => {
    if (status !== "signed-out" || !hasOwnWork || due) return;
    const timer = setTimeout(() => setDue(true), AFTER_MS);
    return () => clearTimeout(timer);
  }, [status, hasOwnWork, due]);

  if (status !== "signed-out" || !due || Date.now() - dismissedAt < QUIET_MS) return null;

  const dismiss = () => {
    const now = Date.now();
    safeStorage.set(DISMISSED_KEY, String(now));
    setDismissedAt(now);
  };

  return (
    <div role="status" className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-sm" data-print-hide>
      <Cloud className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <p className="min-w-0 flex-1 text-muted-foreground">{t("account.nudge")}</p>
      <Button size="sm" className="h-7 shrink-0" onClick={onSignIn}>
        {t("account.signIn")}
      </Button>
      <Button size="sm" variant="ghost" className="h-7 shrink-0" onClick={dismiss}>
        {t("notices.notNow")}
      </Button>
    </div>
  );
}
