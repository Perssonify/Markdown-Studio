import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUIStore } from "@/store/preferences/uiStore";
import { adsAvailable } from "@/utils/build-gates";
import { useT } from "@/i18n";

export type AdUnitVariant = "sidebar-inline" | "floating-bar" | "right-rail";

interface AdUnitProps {
  variant: AdUnitVariant;
  className?: string;
  /** Only render in full chrome — pass `chrome === "full"` from the call site. */
  chromeFull?: boolean;
}

// Module-level flags persist dismissed state across remounts caused by parent
// re-renders, which would otherwise reset useState back to false.
let floatingAdDismissed = false;
let sidebarAdDismissed = false;

/**
 * Optional display-ad slots, gated by the `showAds` setting (off by default; set
 * via Settings/View or the ?ads= URL param) AND full chrome — never shown in the
 * minimal/none embed. All slots are placeholder-only and self-contained; no
 * external ad-network script is loaded (keeps the app offline/CSP-safe). To wire
 * a real network later, replace the placeholder markup inside each variant with
 * the network's slot element — the gating here stays the same.
 *
 * DEVELOPMENT BUILDS ONLY (`adsAvailable`). The toggles and the URL parameter
 * are hidden in production too, but the check that matters is this one: a
 * `pf:show-ads=true` stored by an earlier version, or the embed's own `?ads=`
 * handling, would otherwise still paint "Your Ad Here" over a shipped build.
 *
 *   sidebar-inline — compact banner inside the sidebar doc list.
 *   floating-bar   — wide bottom-anchored bar that slides up (all widths).
 *   right-rail     — tall slot on the right of the editor on wide (xl) screens.
 */
export function AdUnit({ variant, className, chromeFull = true }: AdUnitProps) {
  const showAds = useUIStore((s) => s.showAds);
  if (!adsAvailable() || !showAds || !chromeFull) return null;
  if (variant === "sidebar-inline") return <SidebarInlineAd className={className} />;
  if (variant === "right-rail") return <RightRailAd className={className} />;
  return <FloatingBarAd className={className} />;
}

function RightRailAd({ className }: { className?: string }) {
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className={cn("overflow-hidden rounded-lg", className)}>
      <div className="relative h-full w-full bg-linear-to-b from-violet-500 via-fuchsia-500 to-orange-400">
        <div className="absolute -left-4 -top-4 h-16 w-16 rounded-full bg-yellow-300/40 blur-lg" />
        <div className="absolute bottom-6 -right-3 h-14 w-14 rounded-full bg-cyan-400/40 blur-lg" />
        <div className="absolute left-1.5 top-1.5 rounded bg-black/30 px-1 py-px text-[8px] font-bold uppercase tracking-widest text-white/70">{t("notices.ad")}</div>
        <button
          onClick={() => setDismissed(true)}
          className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-black/25 text-white/80 transition-colors hover:bg-black/50 hover:text-white"
          title={t("notices.closeAd")}
        >
          <X className="size-2.5" />
        </button>
        <div className="flex h-full flex-col items-center justify-center gap-1 px-3 text-center">
          <span className="text-xs font-bold leading-tight text-white drop-shadow">{t("notices.yourAdHere")}</span>
          <span className="text-[10px] text-white/80">{t("notices.reachThousandsOfWriters")}</span>
        </div>
      </div>
    </div>
  );
}

function SidebarInlineAd({ className }: { className?: string }) {
  const t = useT();
  const [dismissed, setDismissed] = useState(() => sidebarAdDismissed);

  const handleClose = () => {
    sidebarAdDismissed = true;
    setDismissed(true);
  };

  if (dismissed) return null;

  return (
    <div className={cn("overflow-hidden rounded-lg h-full", className)} style={{ minHeight: 80 }}>
      <div className="relative h-full w-full bg-linear-to-br from-violet-500 via-fuchsia-500 to-orange-400">
        {/* Blobs */}
        <div className="absolute -left-3 -top-3 h-12 w-12 rounded-full bg-yellow-300/50 blur-md" />
        <div className="absolute -bottom-2 -right-2 h-10 w-10 rounded-full bg-cyan-400/50 blur-md" />
        <div className="absolute right-6 top-2 h-6 w-6 rounded-full bg-pink-300/60 blur-sm" />
        {/* Badge */}
        <div className="absolute left-1.5 top-1.5 rounded bg-black/30 px-1 py-px text-[8px] font-bold uppercase tracking-widest text-white/70">
          {t("notices.ad")}
        </div>
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-black/25 text-white/80 transition-colors hover:bg-black/50 hover:text-white"
          title={t("notices.closeAd")}
        >
          <X className="size-2.5" />
        </button>
        {/* Copy */}
        <div className="flex h-full flex-col items-center justify-center gap-0.5 px-3 text-center">
          <span className="text-[11px] font-bold leading-tight text-white drop-shadow">
            {t("notices.yourAdHere")}
          </span>
          <span className="text-[9px] text-white/80">{t("notices.reachThousandsOfWriters")}</span>
        </div>
      </div>
    </div>
  );
}

function FloatingBarAd({ className }: { className?: string }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  // Local render gate — initialised from the module-level flag so a remount
  // caused by a parent re-render doesn't reset the dismissed state.
  const [dismissed, setDismissed] = useState(() => floatingAdDismissed);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (floatingAdDismissed) return;
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    // Mark dismissed immediately at the module level so any remount caused by
    // a parent re-render during the slide-out animation reads the correct value
    // and does not resurrect the ad.
    floatingAdDismissed = true;
    setVisible(false);
    dismissTimerRef.current = setTimeout(() => setDismissed(true), 400);
  };

  useEffect(() => () => {
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={cn(
        "pointer-events-none relative z-10 mx-auto transition-all duration-500 ease-out",
        visible
          ? "translate-y-0 opacity-100 pointer-events-auto"
          : "translate-y-full opacity-0",
        className
      )}
      style={{ maxWidth: "720px", width: "100%" }}
    >
      <div className="relative overflow-hidden rounded-t-2xl shadow-2xl" style={{ height: 100 }}>
        {/* Gradient */}
        <div className="absolute inset-0 bg-linear-to-r from-violet-600 via-fuchsia-500 to-orange-400" />
        {/* Blobs */}
        <div className="absolute -left-6 -top-6 h-24 w-24 rounded-full bg-yellow-300/40 blur-xl" />
        <div className="absolute -bottom-4 left-1/3 h-16 w-16 rounded-full bg-cyan-400/40 blur-lg" />
        <div className="absolute -right-4 top-0 h-20 w-20 rounded-full bg-pink-400/40 blur-xl" />
        <div className="absolute right-1/4 bottom-0 h-10 w-10 rounded-full bg-lime-300/50 blur-md" />
        {/* Badge */}
        <div className="absolute left-3 top-2 rounded bg-black/30 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest text-white/70">
          {t("notices.sponsored")}
        </div>
        {/* Close */}
        <button
          onClick={handleClose}
          className="absolute right-2 top-2 z-5 flex size-5 items-center justify-center rounded-full bg-black/25 text-white/80 transition-colors hover:bg-black/50 hover:text-white"
          title={t("notices.closeAd")}
        >
          <X className="size-3" />
        </button>
        {/* Content */}
        <div className="relative flex h-full items-center justify-between px-8 pt-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-bold leading-tight text-white drop-shadow-md">
              {t("notices.yourAdHere")}
            </span>
            <span className="text-xs text-white/80">
              {t("notices.reachThousandsOfDevelopersAnd")}
            </span>
          </div>
          <button className="shrink-0 rounded-full border border-white/30 bg-white/20 px-5 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/30">
            {t("notices.learnMore")}
          </button>
        </div>
      </div>
    </div>
  );
}
