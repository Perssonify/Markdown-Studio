/**
 * Public API that is still accepted — removing it would break hosts at compile
 * time — but has no effect. Each one logs ONE console warning per page load, in
 * development builds only, so a host relying on it finds out instead of
 * silently getting nothing.
 */
const warned = new Set<string>();

function isProduction(): boolean {
  // The consumer's bundler replaces `process.env.NODE_ENV` statically (Vite,
  // webpack, Next.js — the bundled Base UI already relies on it). The cast is
  // type-only, so the emitted code keeps the exact dotted form bundlers look
  // for. Without a bundler `process` does not exist: treat that as development.
  try {
    return (process.env as { NODE_ENV?: string }).NODE_ENV === "production";
  } catch {
    return false;
  }
}

export function warnDeprecated(api: string, detail: string): void {
  if (warned.has(api) || isProduction()) return;
  warned.add(api);
  console.warn(`[@perssonify/editor] ${api} is deprecated: ${detail}`);
}

/** Test hook: forget which warnings were shown. */
export function resetDeprecationWarnings(): void {
  warned.clear();
}
