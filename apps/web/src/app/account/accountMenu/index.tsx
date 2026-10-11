import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { useCallback } from "react";
import { useT } from "@/i18n";
import { useToast } from "@/ui/shared/toast";
import { useAccount } from "../account";
import { AccountAvatar } from "../accountAvatar";
import { CloudStatusLine } from "../cloudStatusLine";

interface AccountMenuProps {
  /** Open the sign-in page. */
  onSignIn: () => void;
  /** Open the profile page. */
  onProfile: () => void;
}

/**
 * The account control at the right end of the top header (EditorHeader).
 * Signed out: a "Sign in" button that opens the sign-in page. Signed in: the
 * account's photo, opening a menu with the name and email, Profile and Sign
 * out. Renders NOTHING while the session is being checked or when no account
 * service answers, so a host without the backend shows the editor as before.
 */
export function AccountMenu({ onSignIn, onProfile }: AccountMenuProps) {
  const t = useT();
  const toast = useToast();
  const status = useAccount((s) => s.status);
  const user = useAccount((s) => s.user);
  const signOut = useAccount((s) => s.signOut);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
      toast.show(t("account.signedOut"), "success");
    } catch {
      toast.show(t("account.signOutFailed"), "error");
    }
  }, [signOut, toast, t]);

  if (status === "signed-out") {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5 px-2 pointer-coarse:min-h-9 pointer-coarse:min-w-9"
        title={t("account.signInWithGoogle")}
        aria-label={t("account.signInWithGoogle")}
        onClick={onSignIn}
      >
        <LogIn className="size-4" />
        <span className="hidden text-xs tracking-tight whitespace-nowrap lg:inline-block">{t("account.signIn")}</span>
      </Button>
    );
  }
  if (status !== "signed-in" || !user) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full p-0 pointer-coarse:size-9"
            title={t("account.menuLabel", { name: user.name })}
            aria-label={t("account.menuLabel", { name: user.name })}
          />
        }
      >
        <AccountAvatar user={user} className="size-7 text-[11px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {/* A GroupLabel must sit inside a Group: a bare one throws Base UI
            error #31 (apps/web/CLAUDE.md ▸ MenuBar). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
            <AccountAvatar user={user} className="size-8 text-xs" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuLabel className="pt-0">
            <CloudStatusLine />
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onProfile}>
          <UserRound />
          {t("account.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut />
          {t("account.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
