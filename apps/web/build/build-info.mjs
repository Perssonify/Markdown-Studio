// Which branch and commit a build of the standalone app was made from, for the
// version shown in its header and status bar (src/constants.ts BUILD_INFO).
//
// The host's own variables first — Vercel checks the repository out WITHOUT
// its .git history in some setups, and a CI runner may be on a detached HEAD —
// then git itself; null when neither is there (a tarball, a sandbox). Plain
// ESM so the Vite configs and node-run tests can both import it.
import { execFileSync } from "node:child_process";

/** Run git quietly; null when git or the repository is not there. */
function git(args, cwd) {
  try {
    const out = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * `{ branch, commit }` — the commit shortened to 7 characters, the way git and
 * GitHub show it. `env` and `cwd` are parameters for tests.
 */
export function buildInfo({ env = process.env, cwd = process.cwd() } = {}) {
  const branch =
    env.VERCEL_GIT_COMMIT_REF ||
    env.GITHUB_HEAD_REF || // a pull request's source branch
    env.GITHUB_REF_NAME ||
    git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const sha = env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || git(["rev-parse", "HEAD"], cwd);
  return {
    // A detached checkout reports "HEAD", which names no branch.
    branch: branch && branch !== "HEAD" ? branch : null,
    commit: sha ? sha.slice(0, 7) : null,
  };
}
