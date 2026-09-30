import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { t } from "../i18n";

export type ToastType = "info" | "success" | "error" | "warning";

// Editor lifecycle toasts ("Ready", "Restored: …") are noise — and actively
// trust-eroding — when a static interior page (/help, /about) is on screen.
// The app shell mutes them while such a route is active; errors still show,
// because a failed save matters no matter what page covers the editor.
let interiorMuted = false;
export function setToastsMutedForInteriorPage(muted: boolean) {
  interiorMuted = muted;
}

export function useToast() {
  const show = useCallback((message: string, type: ToastType = "info", duration = 3000) => {
    if (interiorMuted && type !== "error") return;
    const options = {
      duration: duration,
      // sonner's own default name for the × is English.
      closeButtonAriaLabel: t("notices.closeToast"),
    };

    switch (type) {
      case "success":
        toast.success(message, {
          ...options,
          icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />,
        });
        break;
      case "error":
        toast.error(message, {
          ...options,
          icon: <XCircle className="h-4 w-4 text-destructive" />,
        });
        break;
      case "warning":
        toast.warning(message, {
          ...options,
          icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
        });
        break;
      default:
        toast.info(message, {
          ...options,
          icon: <Info className="h-4 w-4 text-blue-500" />,
        });
        break;
    }
  }, []);

  // Stable object identity — a fresh {show} every render defeated React.memo
  // on every component receiving `toast` as a prop (e.g. the toolbar).
  return useMemo(() => ({ show }), [show]);
}