import { APP_NAME, BUILD_INFO, RELEASE_BRANCH, VERSION } from "@/constants";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

/** "v1.78.0" — the package's SemVer version. */
export const versionText = (): string => `v${VERSION}`;

/** A build from a branch other than the release branch (a preview): its branch. */
export const previewBranch = (): string | null =>
  BUILD_INFO.branch && BUILD_INFO.branch !== RELEASE_BRANCH ? BUILD_INFO.branch : null;

/** The whole of it, for a tooltip: version, then branch and commit when known. */
export function buildDescription(): string {
  const { branch, commit } = BUILD_INFO;
  if (branch && commit) return t("status.versionBuilt", { app: APP_NAME, version: VERSION, branch, commit });
  if (commit) return t("status.versionCommit", { app: APP_NAME, version: VERSION, commit });
  return t("status.versionOnly", { app: APP_NAME, version: VERSION });
}

/**
 * The app's version, in the header and the status bar: `v1.78.0` (SemVer,
 * from package.json), and — on a build from any branch but the release
 * branch — that branch beside it, so a preview is never mistaken for
 * production. The commit is in the tooltip.
 */
export function VersionBadge({ className, showBranch = true }: { className?: string; showBranch?: boolean }) {
  const branch = showBranch ? previewBranch() : null;
  const description = buildDescription();
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-1 font-mono text-[10px] leading-none text-muted-foreground", className)}
      title={description}
      aria-label={description}
      data-version={VERSION}
      data-branch={BUILD_INFO.branch ?? undefined}
    >
      <span className="rounded border border-border px-1 py-0.5 tabular-nums">{versionText()}</span>
      {branch && (
        <span className="max-w-40 truncate rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-amber-800 dark:text-amber-400">
          {branch}
        </span>
      )}
    </span>
  );
}
