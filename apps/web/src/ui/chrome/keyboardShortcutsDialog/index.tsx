import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { displayKeys, SHORTCUT_GROUPS } from "@/data/shortcuts";
import { useT } from "@/i18n";

/**
 * A discoverable cheat-sheet of the editor's keyboard shortcuts, shown with
 * the current platform's key glyphs (⌘ on Mac, Ctrl+ elsewhere).
 */
// Rendered from the single shortcuts source (src/data/shortcuts.ts) so this
// dialog can never drift from the Help page or the real bindings again (it
// used to advertise a removed "Focus mode" shortcut).
// Read at render, not at module load: the names follow the interface language.
const GROUPS = (): { title: string; note?: string; items: [string, string][] }[] => SHORTCUT_GROUPS.map((g) => ({
  title: g.group,
  note: g.note,
  items: g.rows.map((r) => [displayKeys(r.keys), r.action] as [string, string]),
}));


/**
 * A plain dialog (components/ui/dialog.tsx), not an alert dialog. It was an
 * AlertDialog: that primitive's size variant outranks a `max-w-*` passed in (a
 * data-attribute selector beats a bare class), so five groups of shortcuts
 * were squeezed into a 24rem column that ran off the top and bottom of the
 * screen, taking the only Close button with it — and an alert dialog cannot
 * be dismissed by a click outside, while the page behind it is scroll-locked.
 * Now the list scrolls inside a box capped to the viewport, Close and × stay
 * on screen, and a click outside closes it.
 */
export function KeyboardShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl" closeLabel={t("common.close")}>
        <DialogHeader>
          <DialogTitle>{t("dialogs.keyboardShortcuts")}</DialogTitle>
          <DialogDescription>{t("dialogs.everydayCommandsShownForThis")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            {GROUPS().map((g) => (
              <div key={g.title}>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.title}
                </div>
                {/* The group's scope caveat, from the same single source. */}
                {g.note && <p className="mb-1.5 text-[11px] leading-snug text-muted-foreground">{g.note}</p>}
                <dl className="space-y-1">
                  {g.items.map(([keys, label]) => (
                    <div key={keys} className="flex items-center justify-between gap-3 text-sm">
                      <dt className="text-foreground">{label}</dt>
                      <dd className="text-right">
                        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {keys}
                        </kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button />}>{t("common.close")}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
