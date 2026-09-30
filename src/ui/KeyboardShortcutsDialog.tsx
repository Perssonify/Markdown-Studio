import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { displayKeys, SHORTCUT_GROUPS } from "../data/shortcuts";
import { useT } from "../i18n";

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


export function KeyboardShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("dialogs.keyboardShortcuts")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("dialogs.everydayCommandsShownForThis")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                    <dd>
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
        <AlertDialogFooter>
          <AlertDialogAction onClick={onClose}>{t("common.close")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
