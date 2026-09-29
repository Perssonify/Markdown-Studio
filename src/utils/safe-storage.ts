/**
 * `localStorage` that cannot throw.
 *
 * Every call site guarded SSR with `typeof localStorage === "undefined"`. That
 * does not cover the case that actually happens in a browser: when a user blocks
 * site data (Chrome's "Block all cookies", some enterprise policies, Safari in
 * certain configurations) the `localStorage` GETTER throws a `SecurityError` —
 * and `typeof localStorage` evaluates the getter, so the guard throws too.
 *
 * `uiStore`'s reads run at MODULE SCOPE inside the store initialiser with no
 * `try` anywhere, so in that configuration the store module fails to evaluate
 * and the app does not render at all. This is the accessor `crash-recovery.ts`
 * already used privately, lifted out so every site shares it.
 *
 * Reads return `null` when storage is unavailable — the same value as "not set",
 * so callers' existing defaults apply unchanged. Writes are silently dropped;
 * the setting still applies for the session.
 */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export const safeStorage = {
  /** The stored string, or null when absent OR unavailable. */
  get(key: string): string | null {
    try {
      return store()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      store()?.setItem(key, value);
    } catch {
      /* quota, private mode, blocked site data — the session keeps the value */
    }
  },
  remove(key: string): void {
    try {
      store()?.removeItem(key);
    } catch {
      /* nothing to remove */
    }
  },
  /** Whether reads and writes will actually persist. */
  available(): boolean {
    return store() !== null;
  },
};
