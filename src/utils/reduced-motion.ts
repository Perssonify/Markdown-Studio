/**
 * Does this user ask for reduced motion?
 *
 * `styles.css` carries a global `@media (prefers-reduced-motion: reduce)` guard
 * that flattens every CSS animation and transition, and for a long time its own
 * comment claimed "JS-driven motion (graph camera easing) is gated separately in
 * GraphView". That was false: no `.tsx` in the repo consulted the query at all,
 * so anything animated from JavaScript ignored the preference entirely.
 *
 * Read at call time rather than cached. The preference can change mid-session
 * (a user toggling it in the OS), and a value captured at module load would be
 * wrong for the rest of the page's life.
 *
 * Fails OPEN — an environment with no `matchMedia` (SSR, jsdom without a stub,
 * an old webview) gets the animated path, which is the status quo, rather than
 * a silently degraded one.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
