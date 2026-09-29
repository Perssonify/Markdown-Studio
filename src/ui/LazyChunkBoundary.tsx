import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Rendered when the lazy chunk fails and we're not auto-reloading. */
  fallback?: (retry: () => void) => ReactNode;
}
interface State {
  failed: boolean;
}

const RELOAD_AT = "pf:preload-reload-at"; // shared with the vite:preloadError guard in main.tsx

/**
 * Error boundary for a `React.lazy` subtree. A dynamic import of a hashed chunk
 * that a previous deploy purged (stale cached index.html) rejects and would
 * otherwise crash the whole app to the top-level ErrorBoundary. Here we catch it
 * locally: reload once to fetch the fresh index + current chunk hashes (throttled
 * against loops, same key as main.tsx), and if that already happened, show a small
 * inline retry instead of taking down the editor.
 */
export class LazyChunkBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch() {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_AT) || "0");
      if (Date.now() - last >= 10_000) {
        sessionStorage.setItem(RELOAD_AT, String(Date.now()));
        location.reload();
      }
    } catch {
      /* sessionStorage unavailable — fall through to the inline retry */
    }
  }

  retry = () => this.setState({ failed: false });

  override render() {
    if (this.state.failed) {
      return this.props.fallback ? this.props.fallback(this.retry) : null;
    }
    return this.props.children;
  }
}
