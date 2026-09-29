import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ErrorInfo, ReactNode } from "react";

export interface ErrorBoundaryProps {
  children: ReactNode;
  isDark?: boolean;
}

interface ErrorBoundaryClassProps {
  children: ReactNode;
  fallback: (props: { error: Error | null; recover: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

class ErrorBoundaryClass extends Component<ErrorBoundaryClassProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryClassProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    console.error("[MarkdownEditor] Crash:", error, errorInfo);
  }

  handleRecover = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  override render() {
    if (this.state.hasError) {
      return this.props.fallback({
        error: this.state.error,
        recover: this.handleRecover,
      });
    }
    return this.props.children;
  }
}

export function ErrorBoundary({ children, isDark }: ErrorBoundaryProps) {
  return (
    <ErrorBoundaryClass
      fallback={({ error, recover }) => (
        <div className={`flex min-h-dvh items-center justify-center bg-background p-6 ${isDark ? "dark" : ""}`}>
          <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-lg">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                </div>
                <div className="space-y-1">
                  <h3 className="font-semibold leading-none tracking-tight">Editor Crashed</h3>
                  <p className="text-sm text-muted-foreground">
                    An unexpected error occurred while rendering the editor.
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
            </div>
            
            <div className="flex items-center justify-end border-t border-border bg-muted/20 p-4">
              <button
                onClick={recover}
                className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Recover Editor
              </button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundaryClass>
  );
}