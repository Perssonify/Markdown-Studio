import { create } from "zustand";

/**
 * The visitor's account: Google sign-in through the backend (apps/api, Better
 * Auth). Standalone app only — the library and the iframe embed never import
 * this module.
 *
 * Every call is same-origin under /api/auth. On AWS, CloudFront sends /api/*
 * to the API; in development Vite proxies /api to it (vite.app.config.ts).
 * Where nothing answers there — a host without the backend, or offline — the
 * state is "unavailable" and the app shows no account controls at all, so the
 * editor behaves exactly as it does without accounts.
 *
 * Signing in does not touch documents: they stay in this browser's storage.
 */
export interface AccountUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** ISO timestamp of the account's creation, when the backend reports it. */
  createdAt: string | null;
}

export type AccountStatus = "loading" | "unavailable" | "signed-out" | "signed-in";

interface AccountState {
  status: AccountStatus;
  user: AccountUser | null;
  /** Ask the backend who is signed in. Never throws. */
  refresh(): Promise<void>;
  /** Start Google sign-in: the page leaves for Google. Throws when it cannot start. */
  signIn(): Promise<void>;
  /** End the session. Throws when the backend refuses. */
  signOut(): Promise<void>;
}

export const AUTH_PATH = "/api/auth";

/** How long the session check may take before the app stops waiting for it. */
export const SESSION_CHECK_TIMEOUT_MS = 8_000;

type BuildEnv = Record<string, string | boolean | undefined>;

/**
 * The build's settings. It must be written as exactly `import.meta.env`: Vite
 * (builds) and Vitest (tests) rewrite only that text — a cast-wrapped form
 * compiled to something else and read a stale copy. The project does not load
 * the `vite/client` types (utils/build-gates.ts), hence the directive.
 */
function buildEnv(): BuildEnv {
  try {
    // @ts-expect-error -- `env` is not on ImportMeta without vite/client types; Vite and Vitest provide it.
    return (import.meta.env as BuildEnv | undefined) ?? {};
  } catch {
    return {};
  }
}

/**
 * Whether this build has accounts: true where a backend serves /api/auth.
 * VITE_ACCOUNTS=on (the AWS deploy builds with it) or the development server
 * turns them on; VITE_ACCOUNTS=off turns them off. Elsewhere — today's Vercel
 * build, the e2e builds, the unit tests — the app makes no account call and
 * shows no account UI: exactly the editor it was before accounts.
 */
export function accountsEnabled(env: BuildEnv = buildEnv()): boolean {
  const flag = env["VITE_ACCOUNTS"];
  if (flag === "on") return true;
  if (flag === "off") return false;
  return env["DEV"] === true && env["MODE"] !== "test";
}

/** The one place the page navigates away (replaced in tests: jsdom cannot navigate). */
export const browserNav = { go: (url: string): void => window.location.assign(url) };
const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

/**
 * Where Google sends the browser back to: the editor after a sign-in, or the
 * sign-in page — with Better Auth's `?error=<code>` — when it did not complete.
 */
export function signInTargets(origin: string): { callbackURL: string; errorCallbackURL: string } {
  return { callbackURL: `${origin}/`, errorCallbackURL: `${origin}/login` };
}

/** The fields of Better Auth's session user this app reads; anything else is ignored. */
interface SessionUser {
  id?: unknown;
  name?: unknown;
  email?: unknown;
  image?: unknown;
  createdAt?: unknown;
}

function toUser(u: SessionUser): AccountUser {
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id: String(u.id ?? ""),
    name: text(u.name) ?? text(u.email) ?? "",
    email: text(u.email) ?? "",
    image: text(u.image),
    createdAt: text(u.createdAt),
  };
}

export const useAccount = create<AccountState>((set) => ({
  status: "loading",
  user: null,

  async refresh() {
    try {
      const res = await fetch(`${AUTH_PATH}/get-session`, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
        // A hung request must not hold the app on its loading screen.
        signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
      });
      // A host without the backend answers 404 with an HTML page; a dev server
      // whose API is not running answers a proxy error. Neither is "signed out".
      if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) {
        set({ status: "unavailable", user: null });
        return;
      }
      const body = (await res.json()) as { user?: SessionUser } | null;
      if (body?.user) set({ status: "signed-in", user: toUser(body.user) });
      else set({ status: "signed-out", user: null });
    } catch {
      set({ status: "unavailable", user: null });
    }
  },

  async signIn() {
    const res = await fetch(`${AUTH_PATH}/sign-in/social`, {
      method: "POST",
      credentials: "same-origin",
      headers: JSON_HEADERS,
      body: JSON.stringify({ provider: "google", ...signInTargets(window.location.origin) }),
    });
    const body = res.ok ? ((await res.json()) as { url?: string } | null) : null;
    if (!body?.url) throw new Error(`sign-in did not start (${res.status})`);
    // A full navigation: the editor's unload safety net (the synchronous
    // stash, the unsaved-changes prompt) covers anything typed but not saved.
    browserNav.go(body.url);
  },

  async signOut() {
    const res = await fetch(`${AUTH_PATH}/sign-out`, {
      method: "POST",
      credentials: "same-origin",
      headers: JSON_HEADERS,
      body: "{}",
    });
    if (!res.ok) throw new Error(`sign-out failed (${res.status})`);
    set({ status: "signed-out", user: null });
  },
}));
