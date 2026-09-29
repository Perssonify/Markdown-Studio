import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface TourStep {
  selector: string;
  title: string;
  body: string;
}

/**
 * Ordered tour steps. Each targets a real, always-visible UI element via a
 * `data-tour` attribute. Steps whose target is not on screen are skipped
 * automatically, so the tour degrades gracefully on small screens / minimal
 * chrome.
 */
// On phones the seven menus collapse behind a single ☰ button, so the first
// step must spotlight THAT and say so — the desktop copy promised a menu row
// that doesn't exist on a phone. The selector targets the menu cluster
// ("menus": the desktop row or the ☰ button), not the full-width bar, so the
// spotlight actually points at what the copy describes.
const isPhoneViewport = () => typeof window !== "undefined" && window.innerWidth < 640;

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="menus"]',
    title: "The menu bar",
    get body() {
      return isPhoneViewport()
        ? "Every command lives behind this menu button — File, Edit, Insert, View, Format, Tools and Help."
        : "Every command lives here — File, Edit, Insert, View, Format, Tools and Help. When in doubt, start in a menu.";
    },
  },
  {
    selector: '[data-tour="mode-switcher"]',
    title: "Choose your layout",
    body: "Switch between Markdown, Rich text, or a Split view of both. On a phone these collapse to icons.",
  },
  {
    selector: '[data-tour="workspace-views"]',
    title: "Two more ways to see your notes",
    body: "Cards is a board of every note for quick capture and sorting. The map shows how your notes link to each other — pick any note in it to see its headings and every link in and out, and click through without leaving the map. Editor brings you back (Esc works too).",
  },
  {
    selector: '[data-tour="settings"]',
    title: "Make it yours",
    body: "Open settings for Markdown options; theme and accent colors also live under View → Appearance.",
  },
  {
    selector: '[data-tour="toolbar"]',
    title: "Quick formatting",
    body: "Bold, lists, links and more for the pane you’re in — plus Save and Undo/Redo, always one click away.",
  },
  {
    selector: '[data-tour="editor"]',
    title: "Two panes, always in sync",
    body: "Type Markdown on the left or rich text on the right — each updates the other instantly. Drag the divider to resize.",
  },
  {
    selector: '[data-tour="workspace"]',
    title: "Your workspace",
    body: "Your files and the document Outline live in this panel on the left. The document you are editing is marked with a coloured bar; pick another and the Outline follows it.",
  },
];

const PAD = 6; // spotlight padding around the target

interface WalkthroughProps {
  run: boolean;
  onFinish: () => void;
}

export function Walkthrough({ run, onFinish }: WalkthroughProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const finish = useCallback(() => {
    setIndex(0);
    onFinish();
  }, [onFinish]);

  // Reset to the first step whenever the tour (re)starts.
  useEffect(() => {
    if (run) setIndex(0);
  }, [run]);

  /** Focus the step card, and hand focus back where it came from when the tour
   *  ends — a tour that opens with focus still on the button you clicked leaves
   *  keyboard and screen-reader users addressing the page behind it. */
  const cardRef = useRef<HTMLDivElement | null>(null);
  const restoreToRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!run) return;
    restoreToRef.current = document.activeElement as HTMLElement | null;
    return () => {
      const back = restoreToRef.current;
      if (back && document.body.contains(back)) back.focus?.();
    };
  }, [run]);
  useEffect(() => {
    if (!run) return;
    cardRef.current?.focus();
    // `rect !== null` matters: the card is not rendered until the spotlight has
    // been measured, so on the FIRST step this effect ran while cardRef was
    // still null and focus never moved — the fix was inoperative exactly where
    // it was needed. A boolean, not `rect` itself: measure() runs on resize and
    // capture-phase scroll and returns a fresh object each time, which would
    // re-steal focus continuously.
  }, [run, index, rect !== null]);

  // Resolve the current step's target, skipping any that aren't rendered.
  useLayoutEffect(() => {
    if (!run) return;
    let step = index;
    let el: Element | null = null;
    while (step < STEPS.length) {
      el = document.querySelector(STEPS[step]!.selector);
      if (el) break;
      step++;
    }
    if (step >= STEPS.length) {
      finish();
      return;
    }
    if (step !== index) {
      setIndex(step);
      return;
    }
    const measure = () => setRect(el!.getBoundingClientRect());
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [run, index, finish]);

  // Advance / retreat. Kept OUTSIDE state updaters (updaters must stay pure —
  // finish() setStates in this component and the parent). goBack scans
  // backward past steps whose targets aren't rendered, mirroring the forward
  // skip, so Back never dead-ends on a hidden step.
  const next = useCallback(() => {
    if (index + 1 >= STEPS.length) finish();
    else setIndex(index + 1);
  }, [index, finish]);

  const goBack = useCallback(() => {
    for (let i = index - 1; i >= 0; i--) {
      if (document.querySelector(STEPS[i]!.selector)) { setIndex(i); return; }
    }
  }, [index]);

  // Keyboard: Esc to skip, arrows / Enter to move. Capture phase + full event
  // containment — the tour is modal, so underlying Escape handlers (help page,
  // graph, dialogs) must not also fire.
  useEffect(() => {
    if (!run) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); e.stopPropagation(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); goBack(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [run, finish, next, goBack]);

  if (!run || !rect) return null;
  const step = STEPS[index]!;

  // Spotlight hole: a transparent box with a huge outer shadow that dims the
  // rest of the screen, plus an accent ring.
  const hole = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    width: rect.width + PAD * 2,
    height: rect.height + PAD * 2,
  };

  // Tooltip placement: below the target if there's room, else above.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tipW = Math.min(320, vw - 24);
  const below = hole.top + hole.height + 12 + 160 < vh;
  const tipTop = below ? hole.top + hole.height + 12 : Math.max(12, hole.top - 12 - 168);
  let tipLeft = hole.left + hole.width / 2 - tipW / 2;
  tipLeft = Math.max(12, Math.min(tipLeft, vw - tipW - 12));

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pf-tour-title"
      aria-describedby="pf-tour-body"
    >
      {/* Dimmer + spotlight (click anywhere outside to advance). */}
      <div
        className="absolute rounded-lg ring-2 ring-primary transition-all duration-200"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
        }}
        onClick={next}
      />

      {/* Tooltip card. Focused on mount and on every step change: as an
          aria-modal dialog that never took focus, a screen-reader user was told
          the rest of the page was inert while their cursor was still out in it,
          and never heard the step they were on. */}
      <div
        ref={cardRef}
        tabIndex={-1}
        className="absolute rounded-xl border border-border bg-card p-4 shadow-2xl outline-none animate-in fade-in zoom-in-95 duration-200"
        style={{ top: tipTop, left: tipLeft, width: tipW }}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id="pf-tour-title" className="text-sm font-semibold">{step.title}</h3>
          <button
            type="button"
            onClick={finish}
            className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close tour"
          >
            <X className="size-4" />
          </button>
        </div>
        <p id="pf-tour-body" className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{step.body}</p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex gap-1" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`size-1.5 rounded-full transition-colors ${i === index ? "bg-primary" : "bg-muted-foreground/30"}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={finish}>Skip</Button>
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={goBack}>Back</Button>
            )}
            <Button size="sm" onClick={next}>
              {index + 1 >= STEPS.length ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
