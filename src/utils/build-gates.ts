/**
 * Build-time gates for surfaces that must not reach production users.
 *
 * `import.meta.env.DEV` is replaced by Vite at build time: `true` under
 * `vite dev` (and vitest), `false` for every `vite build` — the app, the embed
 * and, in library mode, the published package — so a gated surface is dead
 * code in anything a user downloads. It is read through a cast rather than the
 * global `vite/client` types (which this project does not load); the erased
 * expression is exactly `import.meta.env.DEV`, the key Vite replaces. A bundler
 * that does not define it throws or yields undefined, and both read as
 * production — the safe direction.
 *
 * Decisions encoded here (production-readiness audit, A078 / A081):
 *  - The placeholder ad slots ("Your Ad Here") exist for layout work only. A
 *    `?ads=1` link or a stale `pf:show-ads=true` must not be able to make the
 *    shipped product look like an unfinished ad-supported site, so the gate is
 *    checked where the slots RENDER, not just where the toggle lives.
 *  - The Settings "Admin" section (console, context-menu switch, ads) is for
 *    operators. It shows in development, or when `localStorage["pf:admin"]` is
 *    exactly "1" — a deliberate, per-browser opt-in for support sessions.
 */
import { safeStorage } from "./safe-storage";

function readDevFlag(): boolean {
  try {
    return (import.meta as unknown as { env: { DEV?: boolean } }).env.DEV === true;
  } catch {
    return false;
  }
}

/** Mutable so tests can exercise the production branch; nothing else writes it. */
export const buildFlags = { dev: readDevFlag() };

/** Test hook: pretend to be a development (true) or production (false) build. */
export function _setDevBuildForTests(dev: boolean): void {
  buildFlags.dev = dev;
}

/** Whether any ad surface (slots, toggles, the `ads` URL parameter) may exist. */
export function adsAvailable(): boolean {
  return buildFlags.dev;
}

/** The per-browser opt-in that reveals the Admin settings in production. */
export const ADMIN_FLAG_KEY = "pf:admin";

/** Whether the Settings "Admin" section is shown. */
export function adminSettingsAvailable(): boolean {
  return buildFlags.dev || safeStorage.get(ADMIN_FLAG_KEY) === "1";
}

/**
 * The session value a `?ads=` parameter asks for, or null when it must be
 * ignored — absent, or a production build (the parameter is still stripped
 * from the address bar by the caller either way).
 */
export function sessionAdsFromParam(value: string | null): boolean | null {
  if (value === null || !adsAvailable()) return null;
  return value === "true" || value === "1";
}
