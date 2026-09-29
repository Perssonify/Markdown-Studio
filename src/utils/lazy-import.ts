/**
 * Lazy-chunk helpers: memoising a dynamic import without memoising its
 * failure, and recognising the error a failed chunk produces.
 *
 * A note on what a retry can and cannot do, because it is easy to overestimate:
 * browsers cache a FAILED module fetch in the document's module map. Measured in
 * Chromium 151 — `import("/x.js")` answered 404, then the server recovered, and a
 * second `import("/x.js")` rejected again without a single request reaching the
 * server. So within one page, re-running the same import does not recover a
 * chunk the network failed to deliver; what does is (a) not failing — every
 * chunk is precached by the service worker — and (b) a reload. Resetting the
 * memo still matters: a failure that is not a module-map entry (a rejected
 * wrapper, a browser that does retry) must not be pinned for the whole session.
 */

/** Memoise `load()` while it is pending or fulfilled; forget it if it rejects. */
export function cachedImport<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = load().catch((err: unknown) => {
        pending = null; // the next call tries again instead of replaying this failure
        throw err;
      });
    }
    return pending;
  };
}

/**
 * Is this the error a lazily-loaded chunk produces when it cannot be fetched?
 * Chromium, Firefox and Safari word it differently, and Vite's preload helper
 * adds its own; a render error must never be mistaken for one (it would be
 * "fixed" by a reload that fixes nothing).
 */
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === "ChunkLoadError") return true;
  const message = typeof e.message === "string" ? e.message : typeof err === "string" ? err : "";
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (?:CSS )?chunk \S+ failed/i.test(
    message,
  );
}
