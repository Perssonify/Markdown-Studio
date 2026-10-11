import { Component, type ErrorInfo, type ReactNode } from "react";
import { isOnline, reloadForChunkErrorIfSafe } from "@/utils/app-health";
import { recordDiagnostic } from "@/utils/diagnostics";
import { isChunkLoadError } from "@/utils/lazy-import";
import { CopyDiagnosticsButton } from "@/ui/diagnostics/diagnosticsActions";
import { ReloadWhenOnline } from "../errorBoundary";
import { t } from "@/i18n";

interface Props {
  children: ReactNode;
  /** Rendered when the lazy CHUNK failed to load (not for render errors). */
  fallback?: (retry: () => void) => ReactNode;
  /** What this boundary wraps, for the messages ("Find & Replace"). */
  label?: string;
}
interface State {
  error: unknown;
  chunk: boolean;
  dismissed: boolean;
}

/**
 * Error boundary for a `React.lazy` subtree, so one panel failing does not take
 * the whole editor down to the top-level crash screen.
 *
 * It used to treat EVERY error as a stale chunk: it reloaded the page (losing
 * undo history and any unsaved typing's context) — offline included, where the
 * reload lands on the browser's error page — and rendered nothing, so a genuine
 * bug in Find & Replace was swallowed without a trace. Now:
 *
 *  - a chunk that failed to download reloads automatically only when that is
 *    safe (online, nothing unsaved, no reload in the last 10s — app-health);
 *    otherwise it says what happened and offers Reload. Retrying the import in
 *    place cannot help: the browser caches the failed module (lazy-import.ts).
 *  - a render error is recorded in the diagnostics ring and SHOWN, with a
 *    "Try again" that remounts the panel. Never a reload.
 */
export class LazyChunkBoundary extends Component<Props, State> {
  override state: State = { error: null, chunk: false, dismissed: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error, chunk: isChunkLoadError(error), dismissed: false };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    const chunk = isChunkLoadError(error);
    recordDiagnostic({ kind: chunk ? "chunk" : "render", error });
    if (chunk) reloadForChunkErrorIfSafe();
    else console.error("[LazyChunkBoundary] Render error in lazy panel:", error, info.componentStack);
  }

  retry = () => this.setState({ error: null, chunk: false, dismissed: false });

  override render() {
    const { error, chunk, dismissed } = this.state;
    if (!error) return this.props.children;
    if (chunk && this.props.fallback) return this.props.fallback(this.retry);
    if (dismissed) return null;

    const what = this.props.label ?? t("notices.thisPanel");
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div
        role="alert"
        className="fixed left-1/2 top-16 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground shadow-lg"
      >
        <p className="font-medium">
          {chunk ? t("notices.panelCouldNotBeLoaded", { what }) : t("notices.panelRanIntoAnError", { what })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {chunk
            ? isOnline()
              ? t("notices.panelFileCouldNotBeDownloaded")
              : t("notices.panelOfflineNotSaved")
            : t("notices.panelClosedDocumentsNotAffected")}
        </p>
        {!chunk && message && <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">{message}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          {!chunk && (
            <CopyDiagnosticsButton className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted" />
          )}
          <button
            type="button"
            onClick={() => this.setState({ dismissed: true })}
            className="h-8 rounded-md px-3 text-xs text-muted-foreground hover:bg-muted"
          >
            {t("common.dismiss")}
          </button>
          {chunk ? (
            <ReloadWhenOnline className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90" />
          ) : (
            <button
              type="button"
              onClick={this.retry}
              className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              {t("notices.tryAgain")}
            </button>
          )}
        </div>
      </div>
    );
  }
}
