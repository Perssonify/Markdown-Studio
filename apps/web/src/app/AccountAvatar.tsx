import { cn } from "@/lib/utils";
import type { AccountUser } from "./account";

/** First letters of the first two words: "Syed Moinuddin" → "SM". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join("") || "?";
}

/**
 * The account's initials on the theme's accent (`--primary`: the palette
 * chosen in Settings ▸ Appearance, on <html>), so the menu bar and the profile
 * page look like the rest of the app. Not the Google photo: for most accounts
 * that is Google's own coloured letter, which ignores the theme — and it was a
 * request to Google on every page load. Decorative: the name is always next to
 * it or in the control's label.
 */
export function AccountAvatar({ user, className }: { user: AccountUser; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
        className,
      )}
    >
      {initialsOf(user.name || user.email)}
    </span>
  );
}
