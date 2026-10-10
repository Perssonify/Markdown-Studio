import { AlertTriangle, ClipboardCopy, Download, RotateCcw } from "lucide-react";
import { Component, ErrorInfo, ReactNode, useState } from "react";
import { isOnline, pageActions, reloadForChunkErrorIfSafe } from "@/utils/app-health";
import { recordDiagnostic, type DiagnosticEntry } from "@/utils/diagnostics";
import { exportEmergencyBackup } from "@/utils/emergency-backup";
import { isChunkLoadError } from "@/utils/lazy-import";
import { copyDiagnosticsReport } from "@/ui/diagnostics/diagnosticsActions";
import { useT } from "@/i18n";

export interface ErrorBoundaryProps {
  children: ReactNode;
  isDark?: boolean;
  /**
   * Called once per caught crash with the REDACTED diagnostic entry (the same
   * thing "Copy diagnostics" would include) and the original error. For hosts
   * that want to forward crashes to their own reporting.
   */
  onError?: (entry: DiagnosticEntry | null, error: Error) => void;
}

interface ErrorBoundaryClassProps {
  children: ReactNode;
  onError?: ErrorBoundaryProps["onError"];
  fallback: (props: { error: Error | null; chunk: boolean; recover: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  /** The crash is a lazy chunk that failed to load, not a render bug. */
  chunk: boolean;
}

class ErrorBoundaryClass extends Component<ErrorBoundaryClassProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryClassProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, chunk: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error, chunk: isChunkLoadError(error) };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("[MarkdownEditor] Crash:", error, errorInfo);
    const chunk = isChunkLoadError(error);
    const entry = recordDiagnostic({ kind: chunk ? "chunk" : "render", error });
    try {
      this.props.onError?.(entry, error);
    } catch {
      /* a host's reporter must not take the crash screen down with it */
    }
    // A chunk that failed to download is fixed by a reload and by nothing
    // else; do it automatically only when that is safe (see app-health).
    if (chunk) reloadForChunkErrorIfSafe();
  }

  handleRecover = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, chunk: false });
  };

  override render() {
    if (this.state.hasError) {
      return this.props.fallback({
        error: this.state.error,
        chunk: this.state.chunk,
        recover: this.handleRecover,
      });
    }
    return this.props.children;
  }
}

const buttonBase =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

/**
 * The two actions a crashed page must still offer. Both work with the editor
 * gone: the report is built from the diagnostics ring, the backup from the
 * storage adapter.
 */
export function CrashActions() {
  const t = useT();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = async () => {
    const ok = await copyDiagnosticsReport();
    setStatus(ok ? t("notices.diagnosticsCopiedPasteThem") : t("notices.couldNotReachClipboard"));
  };

  const exportDocs = async () => {
    setBusy(true);
    try {
      const n = await exportEmergencyBackup();
      setStatus(n ? t("notices.exportedDocumentsAsBackup", { count: n }) : t("notices.noStoredDocumentsToExport"));
    } catch (e) {
      recordDiagnostic({ kind: "render", error: e });
      setStatus(t("notices.exportFailedToo"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={exportDocs} disabled={busy} className={`${buttonBase} border border-border bg-background hover:bg-muted`}>
          <Download className="h-4 w-4" />
          {t("notices.exportMyDocuments")}
        </button>
        <button type="button" onClick={copy} className={`${buttonBase} border border-border bg-background hover:bg-muted`}>
          <ClipboardCopy className="h-4 w-4" />
          {t("notices.copyDiagnostics")}
        </button>
      </div>
      {status && (
        <p role="status" className="text-xs text-muted-foreground">
          {status}
        </p>
      )}
    </div>
  );
}

/**
 * "Reload" for a chunk failure. Offline, a reload cannot fetch the missing file
 * and may land on the browser's error page, so the button says so instead of
 * reloading; it is read at click time, not frozen at render time.
 */
export function ReloadWhenOnline({ className }: { className?: string }) {
  const t = useT();
  const [offlineNote, setOfflineNote] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {offlineNote && <span className="text-xs text-muted-foreground">{t("notices.youReOfflineTryAgain")}</span>}
      <button
        type="button"
        onClick={() => {
          if (!isOnline()) {
            setOfflineNote(true);
            return;
          }
          pageActions.reload();
        }}
        className={className}
      >
        <RotateCcw className="h-4 w-4" />
        {t("common.reload")}
      </button>
    </div>
  );
}

export function ErrorBoundary({ children, isDark, onError }: ErrorBoundaryProps) {
  const t = useT();
  return (
    <ErrorBoundaryClass
      onError={onError}
      fallback={({ error, chunk, recover }) => (
        <div className={`flex min-h-dvh items-center justify-center bg-background p-6 ${isDark ? "dark" : ""}`}>
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold leading-none tracking-tight">
                    {chunk ? t("notices.partOfTheAppCouldNotLoad") : t("notices.editorCrashed")}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {chunk
                      ? isOnline()
                        ? t("notices.appFileCouldNotBeDownloaded")
                        : t("notices.appOfflineFileNotSaved")
                      : t("notices.unexpectedRenderError")}
                  </p>
                </div>
              </div>

              {error?.message && (
                <div className="mt-5 rounded-lg border border-border/50 bg-muted/50 p-4">
                  <p className="font-mono text-xs text-muted-foreground break-all">
                    {error.message}
                  </p>
                </div>
              )}

              <div className="mt-5">
                <CrashActions />
              </div>
            </div>

            <div className="flex items-center justify-end border-t border-border bg-muted/20 p-4">
              {chunk ? (
                <ReloadWhenOnline className={`${buttonBase} bg-primary text-primary-foreground shadow hover:bg-primary/90`} />
              ) : (
                <button
                  type="button"
                  onClick={recover}
                  className={`${buttonBase} bg-primary text-primary-foreground shadow hover:bg-primary/90`}
                >
                  <RotateCcw className="h-4 w-4" />
                  {t("notices.recoverEditor")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundaryClass>
  );
}
