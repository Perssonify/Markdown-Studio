import { ClipboardCopy } from "lucide-react";
import { useState } from "react";
import { useDocumentStore } from "../store/documentStore";
import { buildDiagnosticsReport, copyText } from "../utils/diagnostics";
import { useT } from "../i18n";

/**
 * Copy the privacy-safe diagnostics report (utils/diagnostics.ts) to the
 * clipboard. Adds the two pieces of live state the report module deliberately
 * does not import: the save status and whether a service worker controls the page.
 */
export async function copyDiagnosticsReport(): Promise<boolean> {
  let saveStatus = "unknown";
  try {
    saveStatus = String(useDocumentStore.getState().saveStatus);
  } catch {
    /* store unavailable — the report is still useful without it */
  }
  const sw =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker.controller
        ? "controlling"
        : "not controlling"
      : "unsupported";
  return copyText(buildDiagnosticsReport({ "Save status": saveStatus, "Service worker": sw }));
}

/**
 * A self-contained "Copy diagnostics" button with its own confirmation line.
 * Used by the crash screens; exported so Help / About can offer the same thing
 * ("Report a problem" needs something to paste).
 */
export function CopyDiagnosticsButton({ className, label }: { className?: string; label?: string }) {
  const t = useT();
  const [status, setStatus] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className={className}
        onClick={async () => {
          const ok = await copyDiagnosticsReport();
          setStatus(ok ? t("notices.copiedNoDocumentContent") : t("notices.couldNotReachClipboard"));
        }}
      >
        <ClipboardCopy className="h-4 w-4" />
        {label ?? t("notices.copyDiagnostics")}
      </button>
      {status && (
        <span role="status" className="text-xs text-muted-foreground">
          {status}
        </span>
      )}
    </span>
  );
}
